"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import {
  parseUnits,
  formatUnits,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import TokenInput from "@/components/TokenInput";
import SlippageControl from "@/components/SlippageControl";
import { useTokens } from "@/state/useTokens";
import { useQuote } from "@/hooks/useQuote";
import { UNI_V3_ADDRESSES } from "@/lib/addresses";

const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "o", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const universalRouterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

const V3_SWAP_EXACT_IN = "0x00" as const;

// Multi-hop capable path encoder: tokens[0..n], fees[0..n-1]
function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  if (tokens.length < 2 || fees.length !== tokens.length - 1) {
    throw new Error("Invalid V3 path: token/fee length mismatch");
  }

  let path = tokens[0].slice(2);
  for (let i = 0; i < fees.length; i++) {
    const feeHex = fees[i].toString(16).padStart(6, "0");
    path += feeHex + tokens[i + 1].slice(2);
  }

  return `0x${path}` as Hex;
}

type Route = {
  tokens: Address[];
  fees: number[];
  viaWeth: boolean;
};

const FEE_CANDIDATES = [500, 3000, 10000] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
// Canonical tokens from the Oku list that we want hidden *only* in Swap selectors.
// Keep these loaded elsewhere (e.g., Pools page).
const HIDDEN_SWAP_TOKENS: Address[] = [
  "0x6b8f39d1bda75523f12ca527c4260ecc4889d547", // WBTC
  "0x3026b071a730261b5c7735dcb83e787e1f55e414", // WETH
  "0xd4348d0219cbf881a28fe1a17e0074388ca0baf6", // USDT
  "0x6ae74e2cf82e830b27fea31f145e20df1860a2e5", // USDC
  "0x63b75d4e00c9c518b0310b78ff6f83aa67e531cd", // WBTC.b
  "0x0499af58073c78074a6ebb5943501d9cafe62570", // WETH.b
  "0x4c9c2f5563f7b6d4f0cc99b6fa5d3d9d99c1e57b", // USDC.b
  "0xf2b060feca9f9cb6f201f79fc12e4c5f5f6d50a5", // USDT.b
].map((a) => a.toLowerCase() as Address);
const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const poolAbi = [
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

type SwapCardProps = {
  initialTokenIn?: Address;
  initialTokenOut?: Address;
  initialFee?: number;
  initialAmountIn?: string;
  initialChainId?: number; // reserved for future chain switching
};

export default function SwapCard({
  initialTokenIn,
  initialTokenOut,
  initialFee,
  initialAmountIn,
  initialChainId: _initialChainId,
}: SwapCardProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { tokens, byAddr } = useTokens();

  // form state (seeded from URL props when provided)
  const [tokenIn, setTokenIn] = useState<Address | undefined>(initialTokenIn);
  const [tokenOut, setTokenOut] = useState<Address | undefined>(
    initialTokenOut
  );
  const [fee, setFee] = useState(
    Number.isFinite(initialFee) ? (initialFee as number) : 3000
  );
  const [amountIn, setAmountIn] = useState(
    typeof initialAmountIn === "string" && initialAmountIn.trim() !== ""
      ? initialAmountIn
      : "0.10"
  );

  // If fee came from URL, don't auto-override it during route finding.
  const feeLockedFromUrl = useRef(Number.isFinite(initialFee));
  const didInitFromUrl = useRef(false);
  const [slippageBps, setSlippageBps] = useState(
    Number(process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 50)
  );

  // routing / pool state
  const [poolErr, setPoolErr] = useState<string | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);

  // balance state for tokenIn
  const [balanceIn, setBalanceIn] = useState<bigint | null>(null);

  // approval / permit2 state
  const [hasAllowance, setHasAllowance] = useState(false);
  const [checkingAllowance, setCheckingAllowance] = useState(false);
  const [approving, setApproving] = useState(false);

  // simulation preview state
  const [lastSimulation, setLastSimulation] = useState<{
    gasEstimate?: bigint;
    value?: bigint;
  } | null>(null);
  const [simulatingPreview, setSimulatingPreview] = useState(false);
  const [status, setStatus] = useState<{
    type: "info" | "error" | "success";
    message: string;
  } | null>(null);

  // metadata for tokens
  const tIn = tokenIn ? byAddr.get(tokenIn.toLowerCase()) : undefined;
  const tOut = tokenOut ? byAddr.get(tokenOut.toLowerCase()) : undefined;

  const wethToken = useMemo(
    () =>
      tokens.find((t) => t.symbol.toLowerCase() === "weth") ??
      tokens.find((t) => t.symbol.toLowerCase() === "wrapped ether"),
    [tokens]
  );
  const wethAddress = wethToken?.address as Address | undefined;

  // Human-readable route label
  const routeLabel = useMemo(() => {
    if (!route || !route.tokens.length) return null;

    try {
      return route.tokens
        .map((addr) => {
          const meta = byAddr.get(addr.toLowerCase());
          return meta?.symbol ?? `${addr.slice(0, 6)}…`;
        })
        .join(" → ");
    } catch {
      return null;
    }
  }, [route, byAddr]);

  // 0) Apply URL-provided params once after tokens hydrate
  useEffect(() => {
    if (didInitFromUrl.current) return;
    if (!tokens.length) return;

    if (initialTokenIn) setTokenIn(initialTokenIn);
    if (initialTokenOut) setTokenOut(initialTokenOut);
    if (Number.isFinite(initialFee)) setFee(initialFee as number);

    if (typeof initialAmountIn === "string" && initialAmountIn.trim() !== "") {
      setAmountIn(initialAmountIn);
    }

    didInitFromUrl.current = true;
  }, [
    tokens.length,
    initialTokenIn,
    initialTokenOut,
    initialFee,
    initialAmountIn,
  ]);

  // 1) Choose sane defaults once tokens load
  useEffect(() => {
    if (!tokens.length) return;
    if (!tokenIn) {
      const weth = tokens.find((t) => t.symbol.toLowerCase() === "weth");
      if (weth) setTokenIn(weth.address as Address);
    }
    if (!tokenOut) {
      const usdc = tokens.find((t) => {
        const s = t.symbol.toLowerCase();
        return s === "usdc.e" || s === "usdc";
      });
      if (usdc) setTokenOut(usdc.address as Address);
    }
  }, [tokens, tokenIn, tokenOut]);

  // 2) amountIn in wei
  const amountInWei = useMemo<bigint>(() => {
    try {
      return parseUnits(amountIn || "0", tIn?.decimals ?? 18);
    } catch {
      return 0n;
    }
  }, [amountIn, tIn?.decimals]);

  // 3) Route finding: choose best fee by on-chain liquidity (direct, then via WETH)
  useEffect(() => {
    let active = true;

    async function findRoute() {
      setPoolErr(null);
      setRoute(null);
      setStatus(null);

      if (!publicClient || !tokenIn || !tokenOut || tokenIn === tokenOut) {
        return;
      }

      const factory = UNI_V3_ADDRESSES.factory as Address;

      // Helper: pick the best direct pool by liquidity
      const getBestDirectPool = async () => {
        let bestFee: number | null = null;
        let bestLiquidity: bigint = 0n;

        for (const feeCandidate of FEE_CANDIDATES) {
          try {
            const [tokenA, tokenB] =
              tokenIn.toLowerCase() < tokenOut.toLowerCase()
                ? [tokenIn, tokenOut]
                : [tokenOut, tokenIn];

            const poolAddr = (await publicClient.readContract({
              address: factory,
              abi: factoryAbi,
              functionName: "getPool",
              args: [tokenA, tokenB, feeCandidate],
            })) as Address;

            if (!poolAddr || poolAddr === ZERO_ADDRESS) continue;

            const liquidity = (await publicClient.readContract({
              address: poolAddr,
              abi: poolAbi,
              functionName: "liquidity",
            })) as bigint;

            if (liquidity > bestLiquidity) {
              bestLiquidity = liquidity;
              bestFee = feeCandidate;
            }
          } catch {
            // ignore and try next fee
          }
        }

        if (bestFee === null || bestLiquidity === 0n) return null;
        return { bestFee, bestLiquidity };
      };

      // Helper: pick best via-WETH route (same fee on both hops)
      const getBestViaWethRoute = async () => {
        if (
          !wethAddress ||
          tokenIn === wethAddress ||
          tokenOut === wethAddress
        ) {
          return null;
        }

        let bestFee: number | null = null;
        let bestLiquidity: bigint = 0n;

        for (const feeCandidate of FEE_CANDIDATES) {
          try {
            const [a0, a1] =
              tokenIn.toLowerCase() < wethAddress.toLowerCase()
                ? [tokenIn, wethAddress]
                : [wethAddress, tokenIn];
            const [b0, b1] =
              wethAddress.toLowerCase() < tokenOut.toLowerCase()
                ? [wethAddress, tokenOut]
                : [tokenOut, wethAddress];

            const pool1 = (await publicClient.readContract({
              address: factory,
              abi: factoryAbi,
              functionName: "getPool",
              args: [a0, a1, feeCandidate],
            })) as Address;
            const pool2 = (await publicClient.readContract({
              address: factory,
              abi: factoryAbi,
              functionName: "getPool",
              args: [b0, b1, feeCandidate],
            })) as Address;

            if (
              !pool1 ||
              pool1 === ZERO_ADDRESS ||
              !pool2 ||
              pool2 === ZERO_ADDRESS
            ) {
              continue;
            }

            const [liq1, liq2] = (await Promise.all([
              publicClient.readContract({
                address: pool1,
                abi: poolAbi,
                functionName: "liquidity",
              }) as Promise<bigint>,
              publicClient.readContract({
                address: pool2,
                abi: poolAbi,
                functionName: "liquidity",
              }) as Promise<bigint>,
            ])) as [bigint, bigint];

            const combined = liq1 < liq2 ? liq1 : liq2; // bottleneck liquidity

            if (combined > bestLiquidity) {
              bestLiquidity = combined;
              bestFee = feeCandidate;
            }
          } catch {
            // ignore and try next fee
          }
        }

        if (bestFee === null || bestLiquidity === 0n) return null;
        return { bestFee, bestLiquidity, weth: wethAddress as Address };
      };

      try {
        setRouting(true);

        // 1. Try best direct pool by liquidity
        const direct = await getBestDirectPool();
        if (!active) return;

        if (direct) {
          setRoute({
            tokens: [tokenIn, tokenOut],
            fees: [direct.bestFee],
            viaWeth: false,
          });
          if (!feeLockedFromUrl.current) setFee(direct.bestFee);
          return;
        }

        // 2. Fallback to best via-WETH route
        const viaWeth = await getBestViaWethRoute();
        if (!active) return;

        if (viaWeth) {
          setRoute({
            tokens: [tokenIn, viaWeth.weth, tokenOut],
            fees: [viaWeth.bestFee, viaWeth.bestFee],
            viaWeth: true,
          });
          if (!feeLockedFromUrl.current) setFee(viaWeth.bestFee);
          return;
        }

        // 3. No route at our supported fee tiers
        setPoolErr("No route found for this pair at supported fee tiers.");
      } catch (e: any) {
        if (!active) return;
        console.error("Routing error", e);
        setPoolErr(e?.message || "No route found for this pair.");
      } finally {
        if (active) setRouting(false);
      }
    }

    findRoute();

    return () => {
      active = false;
    };
  }, [publicClient, tokenIn, tokenOut, wethAddress]);

  // 4) Quote using the resolved route
  const effectiveTokenIn = tokenIn;
  const effectiveTokenOut = useMemo(
    () => (route ? route.tokens[route.tokens.length - 1] : tokenOut),
    [route, tokenOut]
  );

  const {
    amountOut,
    minOut,
    loading: quoting,
    error: quoteErr,
  } = useQuote({
    tokenIn: effectiveTokenIn,
    tokenOut: effectiveTokenOut,
    amountInHuman: amountIn,
    fee,
    slippageBps,
    // These may be ignored by current useQuote until you wire it up.
    pathTokens: route?.tokens,
    pathFees: route?.fees,
  });

  // 5) fetch tokenIn balance
  useEffect(() => {
    let active = true;
    async function run() {
      if (!publicClient || !address || !tokenIn) {
        if (active) setBalanceIn(null);
        return;
      }
      try {
        const bal = (await publicClient.readContract({
          address: tokenIn,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        })) as bigint;
        if (active) setBalanceIn(bal);
      } catch {
        if (active) setBalanceIn(null);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [publicClient, address, tokenIn]);

  const formattedBalanceIn = useMemo(() => {
    if (balanceIn === null || !tIn) return null;
    try {
      return Number(formatUnits(balanceIn, tIn.decimals ?? 18)).toFixed(4);
    } catch {
      return null;
    }
  }, [balanceIn, tIn]);

  // Execution price info
  const priceInfo = useMemo(() => {
    if (!amountOut || amountOut === 0n) return null;
    if (!tIn || !tOut) return null;
    if (amountInWei === 0n) return null;

    try {
      const inFloat = Number(formatUnits(amountInWei, tIn.decimals ?? 18));
      const outFloat = Number(formatUnits(amountOut, tOut.decimals ?? 18));
      if (!isFinite(inFloat) || !isFinite(outFloat)) return null;
      if (inFloat === 0 || outFloat === 0) return null;

      return {
        outPerIn: outFloat / inFloat,
        inPerOut: inFloat / outFloat,
      };
    } catch {
      return null;
    }
  }, [amountOut, amountInWei, tIn, tOut]);

  const canUseMax = balanceIn !== null && balanceIn > 0n && !!tIn;

  function handleMaxClick() {
    if (!canUseMax || !tIn) return;
    const dec = tIn.decimals ?? 18;
    const ninetyNinePercent = (balanceIn! * 99n) / 100n;
    const human = Number(formatUnits(ninetyNinePercent, dec));
    setAmountIn(human.toFixed(6).replace(/\.?0+$/, ""));
  }

  function handleFlipTokens() {
    if (!tokenIn || !tokenOut) return;
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  }

  // --- Allowance helpers (ERC20 + Permit2 internal) ---

  async function checkAllowance() {
    if (!publicClient || !address || !tokenIn) {
      setHasAllowance(false);
      return;
    }

    const permit2 = UNI_V3_ADDRESSES.permit2 as Address;
    const router = (UNI_V3_ADDRESSES as any).universalRouter
      ? ((UNI_V3_ADDRESSES as any).universalRouter as Address)
      : (UNI_V3_ADDRESSES.swapRouter as Address);

    try {
      setCheckingAllowance(true);

      const erc20AllowancePromise = publicClient.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as Address, permit2],
      }) as Promise<bigint>;

      // 🔧 remove the explicit tuple cast here
      const permit2AllowancePromise = publicClient.readContract({
        address: permit2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address as Address, tokenIn as Address, router],
      });

      const [erc20Allowance, [p2Amount]] = await Promise.all([
        erc20AllowancePromise,
        permit2AllowancePromise,
      ]);

      const enough =
        amountInWei > 0n &&
        erc20Allowance >= amountInWei &&
        p2Amount >= amountInWei;

      setHasAllowance(enough);
    } catch (err) {
      console.error("checkAllowance failed", err);
      setHasAllowance(false);
    } finally {
      setCheckingAllowance(false);
    }
  }

  // auto-check allowance when relevant inputs change
  useEffect(() => {
    if (!publicClient || !address || !tokenIn || amountInWei === 0n) {
      setHasAllowance(false);
      return;
    }
    checkAllowance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, address, tokenIn, amountInWei]);

  // Approve button: ensure ERC20 + Permit2 internal allowance
  async function ensureAllowance() {
    if (!walletClient || !publicClient || !address || !tokenIn) return;

    const permit2 = UNI_V3_ADDRESSES.permit2 as Address;
    const router = (UNI_V3_ADDRESSES as any).universalRouter
      ? ((UNI_V3_ADDRESSES as any).universalRouter as Address)
      : (UNI_V3_ADDRESSES.swapRouter as Address);

    try {
      setApproving(true);

      // Step 1: ERC20 allowance user -> Permit2
      const erc20Allowance = (await publicClient.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as Address, permit2],
      })) as bigint;

      if (erc20Allowance < amountInWei) {
        const maxUint256 = (1n << 256n) - 1n;
        const hash = await walletClient.writeContract({
          address: tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [permit2, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      // Step 2: Permit2 internal allowance (user, token, router)
      const [p2Amount] = (await publicClient.readContract({
        address: permit2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address as Address, tokenIn as Address, router],
      })) as unknown as [bigint, bigint, bigint];

      if (p2Amount < amountInWei) {
        const maxUint160 = (1n << 160n) - 1n;
        const fiveYears = 60 * 60 * 24 * 365 * 5; // number (5 years in seconds)
        const now = Math.floor(Date.now() / 1000); // number (current time in seconds)
        const expiration = now + fiveYears; // number

        const hash2 = await walletClient.writeContract({
          address: permit2,
          abi: permit2Abi,
          functionName: "approve",
          args: [tokenIn as Address, router, maxUint160, expiration],
        });
        await publicClient.waitForTransactionReceipt({ hash: hash2 });
      }

      await checkAllowance();
      setStatus({
        type: "success",
        message: "Token spending approved via Permit2.",
      });
    } catch (err: any) {
      console.error("ensureAllowance failed", err);
      setStatus({
        type: "error",
        message:
          err?.shortMessage ??
          err?.message ??
          (typeof err === "string" ? err : "Approve failed"),
      });
      throw err;
    } finally {
      setApproving(false);
    }
  }

  // --- Preview Swap (simulate-only) ---
  async function previewSwap() {
    if (!walletClient || !address || !tokenIn || !tokenOut) return;
    if (!publicClient) return;
    if (!amountOut || amountOut === 0n) return;
    if (!route) return;

    if (!hasAllowance) {
      setStatus({
        type: "info",
        message: "Please approve token spending first to preview.",
      });
      return;
    }

    const deadline = BigInt(
      Math.floor(Date.now() / 1000) +
        Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20) * 60
    );

    const routerAddr = (UNI_V3_ADDRESSES as any).universalRouter
      ? ((UNI_V3_ADDRESSES as any).universalRouter as Address)
      : (UNI_V3_ADDRESSES.swapRouter as Address);

    const amountOutMinimum = minOut ?? 0n;
    const path = encodeV3Path(route.tokens, route.fees);

    const input = encodeAbiParameters(
      parseAbiParameters(
        "address recipient, uint256 amountIn, uint256 amountOutMinimum, bytes path, bool payerIsUser"
      ),
      [address as Address, amountInWei, amountOutMinimum, path, true]
    );

    const commands = V3_SWAP_EXACT_IN as Hex;
    const inputs = [input] as Hex[];

    try {
      setSimulatingPreview(true);

      // 1) Simulate to catch reverts & surface good errors
      await publicClient.simulateContract({
        address: routerAddr,
        abi: universalRouterAbi,
        functionName: "execute",
        args: [commands, inputs, deadline],
        account: address as Address,
        value: 0n,
      });

      // 2) Get an actual gas estimate using estimateContractGas
      const gas = await publicClient.estimateContractGas({
        address: routerAddr,
        abi: universalRouterAbi,
        functionName: "execute",
        args: [commands, inputs, deadline],
        account: address as Address,
        value: 0n,
      });

      setLastSimulation({
        gasEstimate: gas,
        value: 0n,
      });
    } catch (e: any) {
      console.error("Preview simulation failed", e);
      setLastSimulation(null);
      setStatus({
        type: "error",
        message:
          e?.shortMessage ??
          e?.message ??
          (typeof e === "string" ? e : "Preview failed"),
      });
    } finally {
      setSimulatingPreview(false);
    }
  }

  // 6) Swap (requires prior approval + a route)
  async function onSwap() {
    if (!walletClient || !address || !tokenIn || !tokenOut) return;
    if (!publicClient) return;
    if (!amountOut || amountOut === 0n) return;
    if (!route) return;

    if (!hasAllowance) {
      setStatus({
        type: "info",
        message: "Please approve token spending first.",
      });
      return;
    }

    const deadline = BigInt(
      Math.floor(Date.now() / 1000) +
        Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20) * 60
    );

    const routerAddr = (UNI_V3_ADDRESSES as any).universalRouter
      ? ((UNI_V3_ADDRESSES as any).universalRouter as Address)
      : (UNI_V3_ADDRESSES.swapRouter as Address);

    const amountOutMinimum = minOut ?? 0n;
    const path = encodeV3Path(route.tokens, route.fees);

    const input = encodeAbiParameters(
      parseAbiParameters(
        "address recipient, uint256 amountIn, uint256 amountOutMinimum, bytes path, bool payerIsUser"
      ),
      [address as Address, amountInWei, amountOutMinimum, path, true]
    );

    const commands = V3_SWAP_EXACT_IN as Hex;
    const inputs = [input] as Hex[];

    try {
      console.log("Simulating Universal Router swap", {
        routerAddr,
        commands,
        inputs,
        deadline: deadline.toString(),
      });

      const { request } = await publicClient.simulateContract({
        address: routerAddr,
        abi: universalRouterAbi,
        functionName: "execute",
        args: [commands, inputs, deadline],
        account: address as Address,
        value: 0n,
      });

      console.log(
        "Simulation succeeded, sending Universal Router swap tx",
        request
      );

      setLastSimulation({
        gasEstimate: request.gas,
        value: request.value ?? 0n,
      });

      const hash = await walletClient.writeContract(request);

      setStatus({
        type: "success",
        message: `Swap submitted. Tx hash: ${hash}`,
      });
      console.log("Universal Router swap tx sent", hash);
    } catch (e: any) {
      console.error("Swap failed (simulation or send)", e);
      let msg =
        e?.shortMessage ??
        e?.message ??
        (typeof e === "string" ? e : "Swap failed");

      const raw = String(e);
      if (raw.includes("0xf96fb071")) {
        msg =
          'Swap failed due to insufficient Permit2 allowance. Please click "Approve" again or reduce the amount.';
      }

      setStatus({
        type: "error",
        message: msg,
      });
    }
  }

  const disableSwap =
    quoting ||
    routing ||
    !!quoteErr ||
    !!poolErr ||
    !amountOut ||
    !tokenIn ||
    !tokenOut ||
    amountInWei === 0n ||
    !address ||
    !route;

  const disableApprove =
    !address ||
    !tokenIn ||
    amountInWei === 0n ||
    approving ||
    checkingAllowance ||
    hasAllowance;

  const disablePreview =
    !address ||
    !tokenIn ||
    !tokenOut ||
    amountInWei === 0n ||
    simulatingPreview ||
    !hasAllowance ||
    !route;

  // nicer button label
  let buttonLabel = "Swap";
  if (!address) buttonLabel = "Connect wallet";
  else if (!tokenIn || !tokenOut) buttonLabel = "Select tokens";
  else if (!amountIn || Number(amountIn) <= 0) buttonLabel = "Enter amount";
  else if (routing) buttonLabel = "Finding route…";
  else if (quoting) buttonLabel = "Quoting…";
  else if (!amountOut) buttonLabel = "No quote";

  return (
    <div className="max-w-lg mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-4">
      <div className="text-xl font-semibold">Swap</div>

      <div className="bg-neutral-800 rounded-xl p-3">
        <TokenInput
          label="Token In"
          value={tokenIn}
          onChange={setTokenIn}
          excludeAddrs={HIDDEN_SWAP_TOKENS}
        />{" "}
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleFlipTokens}
          className="inline-flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 w-9 h-9 -my-2 shadow"
          aria-label="Flip tokens"
        >
          ⇅
        </button>
      </div>

      <div className="bg-neutral-800 rounded-xl p-3">
        <TokenInput
          label="Token Out"
          value={tokenOut}
          onChange={setTokenOut}
          excludeAddrs={HIDDEN_SWAP_TOKENS}
        />{" "}
      </div>

      <div className="space-y-1 bg-neutral-800 rounded-xl p-3">
        <div className="flex items-center justify-between text-xs opacity-70">
          <span>Amount In</span>
          {tIn && (
            <div className="flex items-center gap-2">
              <span className="opacity-70">
                Balance: {formattedBalanceIn ?? "–"} {tIn.symbol}
              </span>
              <button
                type="button"
                onClick={handleMaxClick}
                disabled={!canUseMax}
                className="px-2 py-0.5 rounded bg-neutral-800 text-[11px] disabled:opacity-40"
              >
                Max
              </button>
            </div>
          )}
        </div>
        <input
          className="w-full bg-neutral-900 p-2 rounded-lg"
          placeholder="0.0"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
        <div className="text-right opacity-80 text-xs">
          <div>Fee tier: {((route?.fees?.[0] ?? fee) / 10000).toFixed(2)}%</div>
        </div>
      </div>

      <div className="text-sm">
        {routing && <span className="opacity-80">Finding best route…</span>}
        {!routing && quoting && (
          <span className="opacity-80">Fetching quote…</span>
        )}

        {!routing && !quoting && (
          <div className="mt-2 bg-neutral-800 rounded-xl p-3 text-center space-y-2">
            {/* Route chips with logos and fee tiers */}
            {route && route.tokens.length > 0 && (
              <div className="text-xs opacity-80 flex flex-col items-center gap-1">
                <span className="uppercase tracking-wide text-[10px] text-neutral-400">
                  Route
                </span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {route.tokens.map((addr, idx) => {
                    const meta = byAddr.get(addr.toLowerCase());
                    const symbol = meta?.symbol ?? `${addr.slice(0, 6)}…`;
                    const logo = (meta as any)?.logoURI as string | undefined;
                    const isLast = idx === route.tokens.length - 1;
                    const hopFee = !isLast ? route.fees[idx] : undefined;

                    return (
                      <div key={addr} className="flex items-center gap-1">
                        {logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logo}
                            alt={symbol}
                            className="w-4 h-4 rounded-full"
                          />
                        )}
                        <span>{symbol}</span>
                        {!isLast && (
                          <span className="mx-1 text-[10px] text-neutral-500 flex items-center gap-1">
                            <span>{((hopFee ?? 0) / 10000).toFixed(2)}%</span>
                            <span>→</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Prominent quote */}
            {amountOut !== null && tOut && (
              <div className="mt-1">
                <div className="text-xs font-semibold text-orange-400 uppercase tracking-wide">
                  Quote
                </div>
                <div className="text-2xl font-semibold text-orange-300">
                  {Number(formatUnits(amountOut, tOut.decimals ?? 18)).toFixed(
                    4
                  )}{" "}
                  {tOut.symbol}
                </div>
              </div>
            )}

            {/* Price info under the main quote */}
            {priceInfo && tIn && tOut && (
              <div className="mt-1 text-xs opacity-60">
                1 {tIn.symbol} ≈ {priceInfo.outPerIn.toFixed(4)} {tOut.symbol}
                <span className="mx-1">·</span>1 {tOut.symbol} ≈{" "}
                {priceInfo.inPerOut.toFixed(4)} {tIn.symbol}
              </div>
            )}

            {/* Fallback when there is no quote yet */}
            {amountOut === null && !quoteErr && (
              <span className="opacity-80 text-xs">No quote yet</span>
            )}
          </div>
        )}
      </div>

      {amountOut !== null && tOut && (
        <div className="text-xs space-y-2">
          <div className="text-center text-orange-400 font-semibold">
            Minimum received (after slippage):{" "}
            {Number(formatUnits(minOut ?? 0n, tOut.decimals ?? 18)).toFixed(4)}{" "}
            {tOut.symbol}
          </div>
          <div className="flex items-center justify-between opacity-60">
            <span>
              {lastSimulation?.gasEstimate
                ? `Estimated gas: ${lastSimulation.gasEstimate.toString()}`
                : "No gas estimate yet"}
            </span>
            <button
              type="button"
              onClick={previewSwap}
              disabled={disablePreview}
              className="text-[11px] underline disabled:opacity-40"
            >
              {simulatingPreview ? "Simulating…" : "Preview swap"}
            </button>
          </div>
        </div>
      )}

      {poolErr && <div className="text-xs text-amber-400">{poolErr}</div>}
      {quoteErr && <div className="text-xs text-red-400">{quoteErr}</div>}

      {status && (
        <div
          className={[
            "text-xs text-center px-3 py-2 rounded-lg",
            status.type === "error"
              ? "bg-red-900/40 text-red-300"
              : status.type === "success"
              ? "bg-emerald-900/40 text-emerald-300"
              : "bg-neutral-800 text-neutral-200",
          ].join(" ")}
        >
          {status.message}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex-1"
          onClick={ensureAllowance}
          disabled={disableApprove}
        >
          {approving ? "Approving…" : hasAllowance ? "Approved" : "Approve"}
        </button>
        <button className="btn flex-1" onClick={onSwap} disabled={disableSwap}>
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
