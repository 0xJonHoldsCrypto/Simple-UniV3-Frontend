'use client'
import { useEffect, useMemo, useState } from 'react'
import { Address } from 'viem'
import { quoteExactInSingle } from '@/lib/univ3/quotes'

export function useQuote({ client, tokenIn, tokenOut, amountInWei, fee, slippageBps }:{
  client:any; tokenIn: Address; tokenOut: Address; amountInWei: bigint; fee:number; slippageBps:number;
}){
  const [amountOut, setAmountOut] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function run(){
      if (!client || !tokenIn || !tokenOut || amountInWei === 0n) { setAmountOut(null); return }
      setLoading(true); setError(null)
      try {
        const out = await quoteExactInSingle({ client, tokenIn, tokenOut, amountIn: String(amountInWei), fee })
        if (!active) return
        setAmountOut(out as bigint)
      } catch (e:any) { if (active) setError(e?.shortMessage || 'Quote failed') }
      finally { if (active) setLoading(false) }
    }
    run(); return () => { active = false }
  }, [client, tokenIn, tokenOut, amountInWei, fee])

  const minOut = useMemo(() => {
    if (!amountOut) return 0n
    return amountOut - (amountOut * BigInt(slippageBps)) / 10_000n
  }, [amountOut, slippageBps])

  return { amountOut, minOut, loading, error }
}