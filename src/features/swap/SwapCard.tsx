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
  { type:'function', name:'allowance', stateMutability:'view', inputs:[{name:'o',type:'address'},{name:'s',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'approve',   stateMutability:'nonpayable', inputs:[{name:'s',type:'address'},{name:'v',type:'uint256'}], outputs:[{type:'bool'}] },
] as const

export default function SwapCard() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { tokens, byAddr } = useTokens()

  // form state
  const [tokenIn, setTokenIn]   = useState<Address | undefined>(undefined)
  const [tokenOut, setTokenOut] = useState<Address | undefined>(undefined)
  const [fee, setFee] = useState(3000) // 0.30%
  const [amountIn, setAmountIn] = useState('0.10')
  const [slippageBps, setSlippageBps] = useState(
    Number(process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 50)
  )
  const [poolErr, setPoolErr] = useState<string | null>(null)

  // 1) Choose sane defaults once tokens load
  useEffect(() => {
    if (!tokens.length) return
    if (!tokenIn) {
      const weth = tokens.find(t => t.symbol.toLowerCase() === 'weth')
      if (weth) setTokenIn(weth.address as Address)
    }
    if (!tokenOut) {
      const usdc = tokens.find(t => {
        const s = t.symbol.toLowerCase()
        return s === 'usdc.e' || s === 'usdc'
      })
      if (usdc) setTokenOut(usdc.address as Address)
    }
  }, [tokens, tokenIn, tokenOut])

  // 2) Quote (uses parseUnits internally and checks pool existence)
  const { amountOut, minOut, decIn, loading: quoting, error: quoteErr } = useQuote({
    tokenIn, tokenOut, amountInHuman: amountIn, fee, slippageBps,
  })

  // amountIn in wei with correct decimals (safe)
  const amountInWei = useMemo<bigint>(() => {
    try { return parseUnits(amountIn || '0', decIn ?? 18) } catch { return 0n }
  }, [amountIn, decIn])

  // 3) Quick preflight pool check to give immediate UX feedback (optional but helpful)
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
    return () => { active = false }
  }, [publicClient, tokenIn, tokenOut, fee])

  // 4) Approve if necessary
  async function ensureAllowance() {
    if (!walletClient || !publicClient || !address || !tokenIn) return
    const allowance = await publicClient.readContract({
      address: tokenIn, abi: erc20Abi, functionName: 'allowance',
      args: [address as Address, UNI_V3_ADDRESSES.swapRouter as Address],
    }) as bigint
    if (allowance >= amountInWei) return
    await walletClient.writeContract({
      address: tokenIn, abi: erc20Abi, functionName: 'approve',
      args: [UNI_V3_ADDRESSES.swapRouter as Address, 2n**256n - 1n],
    })
  }

  // 5) Swap (disabled unless we have a valid quote)
  async function onSwap() {
    if (!walletClient || !address || !tokenIn || !tokenOut) return
    if (!amountOut || amountOut === 0n) return
    await ensureAllowance()
    const deadline = BigInt(
      Math.floor(Date.now()/1000) + Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20)*60
    )

    await walletClient.writeContract({
      address: UNI_V3_ADDRESSES.swapRouter as Address,
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: tokenIn as Address,
        tokenOut: tokenOut as Address,
        fee,
        recipient: address as Address,
        deadline,
        amountIn: amountInWei,
        amountOutMinimum: (minOut ?? 0n),
        sqrtPriceLimitX96: 0n,
      }],
      value: 0n,
    })
  }

  // UI bits
  const tOut = tokenOut ? byAddr.get(tokenOut.toLowerCase()) : undefined
  const disableSwap =
    quoting || !!quoteErr || !!poolErr || !amountOut || !tokenIn || !tokenOut || amountInWei === 0n

  return (
    <div className="max-w-lg mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-4">
      <div className="text-xl font-semibold">Swap</div>

      <TokenInput label="Token In"  value={tokenIn}  onChange={setTokenIn} />
      <TokenInput label="Token Out" value={tokenOut} onChange={setTokenOut} />

      <div className="space-y-1">
        <div className="text-xs opacity-70">Amount In</div>
        <input
          className="w-full bg-neutral-800 p-2 rounded"
          placeholder="0.0"
          value={amountIn}
          onChange={(e)=> setAmountIn(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
        <div className="text-right opacity-80">
          <div>Fee tier: {(fee/10000).toFixed(2)}%</div>
          {/* You can replace this with a selector for 0.05% / 0.3% / 1% */}
        </div>
      </div>

     <div className="text-sm opacity-80">
  {quoting && <span>Fetching quote…</span>}

  {!quoting && amountOut !== null && tOut && (
    <span>
      Quote: {Number(formatUnits(amountOut, tOut.decimals ?? 18)).toFixed(4)} {tOut.symbol}
    </span>
  )}

    {!quoting && amountOut === null && !quoteErr && <span>No quote yet</span>}
</div>

{amountOut !== null && tOut && (
  <div className="text-xs opacity-60">
    Minimum received (after slippage):{' '}
    {Number(formatUnits(minOut, tOut.decimals ?? 18)).toFixed(4)} {tOut.symbol}
  </div>
)}

{quoteErr && <div className="text-xs text-red-400">{quoteErr}</div>}      {poolErr && <div className="text-xs text-amber-400">{poolErr}</div>}
      {quoteErr && <div className="text-xs text-red-400">{quoteErr}</div>}

      <button className="btn w-full" onClick={onSwap} disabled={disableSwap}>
        {quoting ? 'Quoting…' : 'Swap'}
      </button>
    </div>
  )
}