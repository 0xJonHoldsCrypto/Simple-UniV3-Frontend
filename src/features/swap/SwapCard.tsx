'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { parseUnits, formatUnits, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'

import TokenInput from '@/components/TokenInput'
import SlippageControl from '@/components/SlippageControl'
import { useTokens } from '@/state/useTokens'
import { useQuote } from '@/hooks/useQuote'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'
import { swapRouterAbi } from '@/lib/univ3/swap'
import { requirePool } from '@/lib/univ3/pools'

const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'o', type: 'address' },
      { name: 's', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 's', type: 'address' },
      { name: 'v', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'o', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const permit2Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
] as const

const V3_SWAP_EXACT_IN = '0x00' as const

function encodeV3Path(tokenIn: Address, tokenOut: Address, fee: number): Hex {
  const feeHex = fee.toString(16).padStart(6, '0')
  return (`0x${tokenIn.slice(2)}${feeHex}${tokenOut.slice(2)}`) as Hex
}

export default function SwapCard() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { tokens, byAddr } = useTokens()

  // form state
  const [tokenIn, setTokenIn] = useState<Address | undefined>(undefined)
  const [tokenOut, setTokenOut] = useState<Address | undefined>(undefined)
  const [fee, setFee] = useState(3000) // 0.30%
  const [amountIn, setAmountIn] = useState('0.10')
  const [slippageBps, setSlippageBps] = useState(
    Number(process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 50),
  )
  const [poolErr, setPoolErr] = useState<string | null>(null)

  // NEW: balance state for tokenIn
  const [balanceIn, setBalanceIn] = useState<bigint | null>(null)

  // metadata for tokens
  const tIn = tokenIn ? byAddr.get(tokenIn.toLowerCase()) : undefined
  const tOut = tokenOut ? byAddr.get(tokenOut.toLowerCase()) : undefined

  // 1) Choose sane defaults once tokens load
  useEffect(() => {
    if (!tokens.length) return
    if (!tokenIn) {
      const weth = tokens.find((t) => t.symbol.toLowerCase() === 'weth')
      if (weth) setTokenIn(weth.address as Address)
    }
    if (!tokenOut) {
      const usdc = tokens.find((t) => {
        const s = t.symbol.toLowerCase()
        return s === 'usdc.e' || s === 'usdc'
      })
      if (usdc) setTokenOut(usdc.address as Address)
    }
  }, [tokens, tokenIn, tokenOut])

  // 2) Quote (uses parseUnits internally and checks pool existence)
  const {
    amountOut,
    minOut,
    decIn,
    loading: quoting,
    error: quoteErr,
  } = useQuote({
    tokenIn,
    tokenOut,
    amountInHuman: amountIn,
    fee,
    slippageBps,
  })

  // amountIn in wei with correct decimals (safe)
  const amountInWei = useMemo<bigint>(() => {
    try {
      return parseUnits(amountIn || '0', decIn ?? 18)
    } catch {
      return 0n
    }
  }, [amountIn, decIn])

  // 3) Quick preflight pool check to give immediate UX feedback
  useEffect(() => {
    let active = true
    async function run() {
      setPoolErr(null)
      if (!publicClient || !tokenIn || !tokenOut) return
      try {
        await requirePool(publicClient, tokenIn, tokenOut, fee)
      } catch (e: any) {
        if (active) setPoolErr(e?.message || 'Pool not found for selected fee')
      }
    }
    run()
    return () => {
      active = false
    }
  }, [publicClient, tokenIn, tokenOut, fee])

  // 4) NEW: fetch tokenIn balance
  useEffect(() => {
    let active = true
    async function run() {
      if (!publicClient || !address || !tokenIn) {
        if (active) setBalanceIn(null)
        return
      }
      try {
        const bal = (await publicClient.readContract({
          address: tokenIn,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as Address],
        })) as bigint
        if (active) setBalanceIn(bal)
      } catch {
        if (active) setBalanceIn(null)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [publicClient, address, tokenIn])

  const formattedBalanceIn = useMemo(() => {
    if (balanceIn === null || !tIn) return null
    try {
      return Number(
        formatUnits(balanceIn, tIn.decimals ?? 18),
      ).toFixed(4)
    } catch {
      return null
    }
  }, [balanceIn, tIn])

  const canUseMax = balanceIn !== null && balanceIn > 0n && !!tIn

  function handleMaxClick() {
    if (!canUseMax || !tIn) return
    const dec = tIn.decimals ?? 18
    const ninetyNinePercent = (balanceIn! * 99n) / 100n
    const human = Number(
      formatUnits(ninetyNinePercent, dec),
    )
    // keep it sane; 6 decimals should be plenty
    setAmountIn(human.toFixed(6).replace(/\.?0+$/, ''))
  }

  // 5) Approve if necessary
  async function ensureAllowance() {
    if (!walletClient || !publicClient || !address || !tokenIn) return

    const permit2 = UNI_V3_ADDRESSES.permit2 as Address
    const router = (UNI_V3_ADDRESSES as any).universalRouter
      ? ((UNI_V3_ADDRESSES as any).universalRouter as Address)
      : ((UNI_V3_ADDRESSES.swapRouter as Address))

    // --- Step 1: Ensure ERC20 allowance from user -> Permit2 ---
    const erc20Allowance = (await publicClient.readContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address as Address, permit2],
    })) as bigint

    if (erc20Allowance < amountInWei) {
      const maxUint256 = (1n << 256n) - 1n
      const hash = await walletClient.writeContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: 'approve',
        args: [permit2, maxUint256],
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }

    // --- Step 2: Ensure Permit2 internal allowance (user, token, router) ---
    const [p2Amount] = (await publicClient.readContract({
      address: permit2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [address as Address, tokenIn as Address, router],
    })) as unknown as [bigint, bigint, bigint]

    if (p2Amount < amountInWei) {
      const maxUint160 = (1n << 160n) - 1n
      const fiveYears = 60n * 60n * 24n * 365n * 5n
      const now = BigInt(Math.floor(Date.now() / 1000))
      const expiration = now + fiveYears

      const hash2 = await walletClient.writeContract({
        address: permit2,
        abi: permit2Abi,
        functionName: 'approve',
        args: [tokenIn as Address, router, maxUint160, expiration],
      })
      await publicClient.waitForTransactionReceipt({ hash: hash2 })
    }
  }

  // 6) Swap (disabled unless we have a valid quote)
  async function onSwap() {
    if (!walletClient || !address || !tokenIn || !tokenOut) return
    if (!publicClient) return
    if (!amountOut || amountOut === 0n) return

    // Ensure the router has enough allowance first
    await ensureAllowance()

    const deadline = BigInt(
      Math.floor(Date.now() / 1000) +
        Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20) * 60,
    )

    const router = (UNI_V3_ADDRESSES as any).universalRouter
      ? ((UNI_V3_ADDRESSES as any).universalRouter as Address)
      : ((UNI_V3_ADDRESSES.swapRouter as Address))

    const amountOutMinimum = minOut ?? 0n

    const path = encodeV3Path(tokenIn as Address, tokenOut as Address, fee)

    const input = encodeAbiParameters(
      parseAbiParameters(
        'address recipient, uint256 amountIn, uint256 amountOutMinimum, bytes path, bool payerIsUser',
      ),
      [address as Address, amountInWei, amountOutMinimum, path, true],
    )

    const commands = V3_SWAP_EXACT_IN as Hex
    const inputs = [input] as Hex[]

    try {
      console.log('Simulating Universal Router swap', {
        router,
        commands,
        inputs,
        deadline: deadline.toString(),
      })

      await publicClient.simulateContract({
        address: router,
        abi: universalRouterAbi,
        functionName: 'execute',
        args: [commands, inputs, deadline],
        account: address as Address,
        value: 0n,
      })

      console.log('Simulation succeeded, sending Universal Router swap tx')

      const hash = await walletClient.writeContract({
        address: router,
        abi: universalRouterAbi,
        functionName: 'execute',
        args: [commands, inputs, deadline],
        value: 0n,
      })

      console.log('Universal Router swap tx sent', hash)
    } catch (e: any) {
      console.error('Swap failed (simulation or send)', e)
      const msg =
        e?.shortMessage ??
        e?.message ??
        (typeof e === 'string' ? e : 'Swap failed')
      if (typeof window !== 'undefined') {
        window.alert(msg)
      }
    }
  }

  const disableSwap =
    quoting ||
    !!quoteErr ||
    !!poolErr ||
    !amountOut ||
    !tokenIn ||
    !tokenOut ||
    amountInWei === 0n ||
    !address

  // nicer button label
  let buttonLabel = 'Swap'
  if (!address) buttonLabel = 'Connect wallet'
  else if (!tokenIn || !tokenOut) buttonLabel = 'Select tokens'
  else if (!amountIn || Number(amountIn) <= 0) buttonLabel = 'Enter amount'
  else if (quoting) buttonLabel = 'Quoting…'
  else if (!amountOut) buttonLabel = 'No quote'

  return (
    <div className="max-w-lg mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-4">
      <div className="text-xl font-semibold">Swap</div>

      <TokenInput label="Token In" value={tokenIn} onChange={setTokenIn} />
      <TokenInput label="Token Out" value={tokenOut} onChange={setTokenOut} />

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs opacity-70">
          <span>Amount In</span>
          {tIn && (
            <div className="flex items-center gap-2">
              <span className="opacity-70">
                Balance:{' '}
                {formattedBalanceIn ?? '–'} {tIn.symbol}
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
          className="w-full bg-neutral-800 p-2 rounded"
          placeholder="0.0"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
        <div className="text-right opacity-80">
          <div>Fee tier: {(fee / 10000).toFixed(2)}%</div>
          {/* Auto-fee tier logic can adjust `fee` in the future */}
        </div>
      </div>

      <div className="text-sm opacity-80">
        {quoting && <span>Fetching quote…</span>}

        {!quoting && amountOut !== null && tOut && (
          <span>
            Quote:{' '}
            {Number(
              formatUnits(amountOut, tOut.decimals ?? 18),
            ).toFixed(4)}{' '}
            {tOut.symbol}
          </span>
        )}

        {!quoting && amountOut === null && !quoteErr && (
          <span>No quote yet</span>
        )}
      </div>

      {amountOut !== null && tOut && (
        <div className="text-xs opacity-60">
          Minimum received (after slippage):{' '}
          {Number(
            formatUnits(minOut, tOut.decimals ?? 18),
          ).toFixed(4)}{' '}
          {tOut.symbol}
        </div>
      )}

      {poolErr && <div className="text-xs text-amber-400">{poolErr}</div>}
      {quoteErr && <div className="text-xs text-red-400">{quoteErr}</div>}

      <button
        className="btn w-full"
        onClick={onSwap}
        disabled={disableSwap}
      >
        {buttonLabel}
      </button>
    </div>
  )
}