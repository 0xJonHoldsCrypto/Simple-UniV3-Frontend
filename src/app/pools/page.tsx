'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTokens } from '@/state/useTokens'

export type RawPool = {
  pool: string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
  liquidity: string
  slot0?: {
    sqrtPriceX96: string
    tick: number
  } | null
}

// --- helpers ---------------------------------------------------

const shortAddr = (a?: string | null) => {
  if (!a) return '-'
  if (a.length < 10) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

const formatLiquidity = (liq?: string | null) => {
  if (!liq) return '0'
  try {
    const big = BigInt(liq)
    if (big === 0n) return '0'
    const s = big.toString()
    if (s.length <= 6) return s
    const headLen = s.length % 3 || 3
    const head = s.slice(0, headLen)
    const rest = s.slice(headLen).match(/.{1,3}/g) ?? []
    return [head, ...rest].join(',')
  } catch {
    return liq
  }
}

// --- page ------------------------------------------------------

export default function PoolsPage() {
  const { byAddr } = useTokens()
  const [rows, setRows] = useState<RawPool[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(refresh = false) {
    setError(null)
    setLoading(true)
    try {
      const url = refresh ? '/api/pools?refresh=1' : '/api/pools'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as RawPool[]

      // filter out any diag/summary/malformed entries
      const valid = data.filter(
        (r) =>
          r &&
          typeof r.pool === 'string' &&
          r.pool.startsWith('0x') &&
          r.token0 &&
          r.token1
      )

      setRows(valid)
    } catch (e: any) {
      setError(e?.message || 'Failed to load pools')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
  }, [])

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        t0: byAddr.get(r.token0.toLowerCase()),
        t1: byAddr.get(r.token1.toLowerCase()),
      })),
    [rows, byAddr]
  )

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Pools</h1>
        <button
          className="px-4 py-2 rounded-full bg-orange-500 hover:bg-orange-600 text-sm font-medium"
          onClick={() => load(true)}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900/80">
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-2">Pool</th>
              <th className="px-4 py-2">Pair</th>
              <th className="px-4 py-2">Fee</th>
              <th className="px-4 py-2">Tick</th>
              <th className="px-4 py-2">Tick Spacing</th>
              <th className="px-4 py-2">Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {enriched.length === 0 && !loading && !error && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  No pools found.
                </td>
              </tr>
            )}

            {enriched.map((r) => (
              <tr
                key={`${r.pool}-${r.fee}`}
                className="border-t border-neutral-800"
              >
                {/* Pool address */}
                <td className="px-4 py-2 font-mono">{shortAddr(r.pool)}</td>

                {/* Pair with token logos + symbols */}
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {/* token0 */}
                    {r.t0?.logoURI ? (
                      <img
                        src={r.t0.logoURI}
                        alt={r.t0.symbol}
                        className="w-5 h-5 rounded-full object-contain bg-neutral-800"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-neutral-700" />
                    )}
                    <span>{r.t0?.symbol ?? shortAddr(r.token0)}</span>
                    <span className="opacity-60">/</span>
                    {/* token1 */}
                    {r.t1?.logoURI ? (
                      <img
                        src={r.t1.logoURI}
                        alt={r.t1.symbol}
                        className="w-5 h-5 rounded-full object-contain bg-neutral-800"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-neutral-700" />
                    )}
                    <span>{r.t1?.symbol ?? shortAddr(r.token1)}</span>
                  </div>
                </td>

                {/* Fee */}
                <td className="px-4 py-2">
                  {Number.isFinite(r.fee as any)
                    ? `${(r.fee / 10000).toFixed(2)}%`
                    : '-'}
                </td>

                {/* Tick */}
                <td className="px-4 py-2">{r.slot0 ? r.slot0.tick : '-'}</td>

                {/* Tick spacing */}
                <td className="px-4 py-2">{r.tickSpacing}</td>

                {/* Liquidity */}
                <td className="px-4 py-2">{formatLiquidity(r.liquidity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}