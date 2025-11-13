'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { parseUnits, formatUnits } from 'viem'
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
    const allowance = (await publicClient.readContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address as Address, UNI_V3_ADDRESSES.swapRouter as Address],
    })) as bigint
    if (allowance >= amountInWei) return
    await walletClient.writeContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: 'approve',
      args: [UNI_V3_ADDRESSES.swapRouter as Address, 2n ** 256n - 1n],
    })
  }

  // 6) Swap (disabled unless we have a valid quote)
  async function onSwap() {
    if (!walletClient || !address || !tokenIn || !tokenOut) return
    if (!amountOut || amountOut === 0n) return
    await ensureAllowance()
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) +
        Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20) * 60,
    )

    await walletClient.writeContract({
      address: UNI_V3_ADDRESSES.swapRouter as Address,
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: tokenIn as Address,
          tokenOut: tokenOut as Address,
          fee,
          recipient: address as Address,
          deadline,
          amountIn: amountInWei,
          amountOutMinimum: minOut ?? 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
      value: 0n,
    })
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