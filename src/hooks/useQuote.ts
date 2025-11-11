// src/hooks/useQuote.ts
'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { useTokens } from '@/state/useTokens'
import { quoteExactInSingle } from '@/lib/univ3/quotes'

export function useQuote({
  tokenIn,
  tokenOut,
  amountInHuman,
  fee,
  slippageBps,
}: {
  tokenIn?: Address
  tokenOut?: Address
  amountInHuman: string
  fee: number
  slippageBps: number
}) {
  const client = usePublicClient()
  const { byAddr } = useTokens()

  const [amountOut, setAmountOut] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefer decimals from token list; fall back to 18
  const decIn = useMemo(() => {
    return tokenIn ? (byAddr.get(tokenIn.toLowerCase())?.decimals ?? 18) : 18
  }, [byAddr, tokenIn])

  useEffect(() => {
    let active = true

    async function run() {
      setError(null)
      setAmountOut(null)

      try {
        if (!client) throw new Error('No public client')
        if (!tokenIn || !tokenOut) return // UI not ready yet
        if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
          throw new Error('Pick two different tokens')
        }

        const amt = Number(amountInHuman || '0')
        if (!Number.isFinite(amt) || amt <= 0) {
          return // wait until user enters a positive amount
        }

        setLoading(true)

        const out = await quoteExactInSingle(client, {
          tokenIn,
          tokenOut,
          fee,
          amountInHuman,
          decimalsIn: decIn,
        })

        if (!active) return
        setAmountOut(out)
      } catch (e: any) {
        if (!active) return
        const msg = e?.shortMessage || e?.message || 'Quote failed'
        console.warn('[useQuote]', msg, e)
        setError(msg)
      } finally {
        if (active) setLoading(false)
      }
    }

    run()
    return () => {
      active = false
    }
  }, [client, tokenIn, tokenOut, amountInHuman, fee, decIn])

  const minOut = useMemo(() => {
    if (!amountOut) return 0n
    return amountOut - (amountOut * BigInt(slippageBps)) / 10_000n
  }, [amountOut, slippageBps])

  return { amountOut, minOut, decIn, loading, error }
}