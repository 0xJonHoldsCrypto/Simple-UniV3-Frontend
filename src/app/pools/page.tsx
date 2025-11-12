'use client'
import { useEffect, useState } from 'react'

type Row = {
  pool: string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
  liquidity: string
  slot0: null | { sqrtPriceX96: string; tick: number }
  t0?: { symbol: string }
  t1?: { symbol: string }
}

export default function PoolsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        setLoading(true); setError(null); setRows([])
        // Try streaming first
        const res = await fetch('/api/pools/stream', { cache: 'no-store' })
        if (res.ok && (res.headers.get('Content-Type') || '').includes('ndjson')) {
          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let idx
            while ((idx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, idx).trim()
              buffer = buffer.slice(idx + 1)
              if (!line) continue
              try {
                const obj = JSON.parse(line) as Row | { error: string }
                if ('error' in obj) { setError(obj.error); continue }
                if (!cancelled) setRows(prev => [obj as Row, ...prev]) // prepend or push
              } catch {/* ignore bad line */}
            }
          }
          setLoading(false)
          return
        }

        // Fallback to cached JSON
        const res2 = await fetch('/api/pools', { cache: 'no-store' })
        const j = await res2.json()
        if (!res2.ok) throw new Error(j?.error || 'Failed to load pools')
        setRows(j as Row[])
        setLoading(false)
      } catch (e:any) {
        setError(e?.message || 'Failed to load')
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pools</h1>
        <button
          className="btn"
          onClick={()=>window.location.href='/pools?refresh=1'}
        >Refresh now</button>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}
      {loading && !rows.length && <div className="opacity-70 text-sm">Loading pools…</div>}

      {!!rows.length && (
        <div className="overflow-x-auto text-sm">
          <table className="w-full">
            <thead className="text-left opacity-80">
              <tr>
                <th>Pool</th><th>Pair</th><th>Fee</th><th>Tick</th><th>Tick Spacing</th><th>Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pool} className="border-t border-neutral-800">
                  <td className="font-mono">{r.pool.slice(0,6)}…{r.pool.slice(-4)}</td>
                  <td>{(r.t0?.symbol || r.token0.slice(0,6))} / {(r.t1?.symbol || r.token1.slice(0,6))}</td>
                  <td>{(r.fee/10000).toFixed(2)}%</td>
                  <td>{r.slot0 ? r.slot0.tick : '-'}</td>
                  <td>{r.tickSpacing}</td>
                  <td>{r.liquidity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}