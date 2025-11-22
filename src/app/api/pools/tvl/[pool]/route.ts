// src/app/api/pools/tvl/[pool]/route.ts
import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
  isAddress,
} from "viem";
import { hemi } from "@/lib/chains/hemi";

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

const client = createPublicClient({
  chain: hemi,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL!),
});

// lightweight token USD lookup using Gecko-terminal token API
async function getTokenUsdPrice(addr: string): Promise<number | null> {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/hemi/tokens/${addr}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json: any = await res.json();
    const price = Number(json?.data?.attributes?.price_usd);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

// stable quick fallback
function stableFallback(addr: string): number | null {
  const a = addr.toLowerCase();
  const isStable =
    a === "0xad11a8beb98bbf61dbb1aa0f6d6f2ecd87b35afa" || // USDC.e
    a === "0x4200000000000000000000000000000000000006";     // (example stable or native mapping)
  return isStable ? 1 : null;
}

export async function GET(
  req: Request,
  { params }: { params: { pool: string } }
) {
  const poolParam = params.pool?.toLowerCase();

  if (!poolParam || !isAddress(poolParam)) {
    return NextResponse.json(
      { error: "Invalid pool address" },
      { status: 400 }
    );
  }

  const pool = poolParam as Address;

  try {
    // Need token0 / token1 from the pool
    const poolAbi = [
      { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
      { name: "token1", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    ] as const;

    const token0 = await client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "token0",
    });

    const token1 = await client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "token1",
    });

    // On-chain balances
    const [bal0, bal1, dec0, dec1] = await Promise.all([
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pool],
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pool],
      }),
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    ]);

    const amt0 = Number(formatUnits(bal0, dec0));
    const amt1 = Number(formatUnits(bal1, dec1));

    // prices
    let p0 = await getTokenUsdPrice(token0.toLowerCase());
    let p1 = await getTokenUsdPrice(token1.toLowerCase());

    if (p0 == null) p0 = stableFallback(token0);
    if (p1 == null) p1 = stableFallback(token1);

    // if still null → treat as 0 but mark as partial
    const partial =
      (p0 == null && amt0 > 0) || (p1 == null && amt1 > 0);

    const tvlUsd =
      (p0 ?? 0) * amt0 +
      (p1 ?? 0) * amt1;

    return NextResponse.json({
      pool: poolParam,
      token0,
      token1,
      amount0: amt0,
      amount1: amt1,
      price0: p0,
      price1: p1,
      tvlUsd,
      partial,
      source: partial ? "partial-onchain" : "onchain+gecko-token",
    });
  } catch (e: any) {
    console.error("TVL fallback error", e);
    return NextResponse.json(
      { error: e?.message || "TVL fetch failed" },
      { status: 500 }
    );
  }
}