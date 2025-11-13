// src/hooks/usePositions.ts
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { useTokens } from '@/state/useTokens'
import { fetchUserPositions, type RawPosition } from '@/lib/univ3/position'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'
import { isAddress } from 'viem'

export type UiPosition = RawPosition & {
  t0?: {
    symbol?: string
    name?: string
    logoURI?: string
  }
  t1?: {
    symbol?: string
    name?: string
    logoURI?: string
  }
}

export function usePositions() {
  const { address } = useAccount()
  const client = usePublicClient()
  const { byAddr } = useTokens()

  const [positions, setPositions] = useState<UiPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function run() {
      setError(null)
      setPositions([])

      if (!client || !address) return

      const nfpmAddr = UNI_V3_ADDRESSES.nfpm as string | undefined
      if (!nfpmAddr || !isAddress(nfpmAddr)) {
        setError('Positions contract (NFPM) is not configured on this network.')
        return
      }

      setLoading(true)
      try {
        const raw = await fetchUserPositions(client as any, address as Address)
        if (!active) return

        const enriched: UiPosition[] = raw.map((p) => {
          const t0 = byAddr.get(p.token0.toLowerCase())
          const t1 = byAddr.get(p.token1.toLowerCase())
          return {
            ...p,
            t0: t0 && {
              symbol: t0.symbol,
              name: t0.name,
              logoURI: t0.logoURI,
            },
            t1: t1 && {
              symbol: t1.symbol,
              name: t1.name,
              logoURI: t1.logoURI,
            },
          }
        })

        setPositions(enriched)
      } catch (e: any) {
        if (!active) return
        const msg =
          e?.shortMessage ||
          e?.message ||
          'Failed to load positions (check console for details)'
        setError(msg)
        console.error('[usePositions] error', e)
      } finally {
        if (active) setLoading(false)
      }
    }

    run()
    return () => {
      active = false
    }
  }, [client, address, byAddr])

  const hasPositions = useMemo(() => positions.length > 0, [positions])

  return { positions, loading, error, hasPositions }
}