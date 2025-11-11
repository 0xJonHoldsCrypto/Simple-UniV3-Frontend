'use client'
import { useMemo, useState } from 'react'
import { useTokens } from '@/state/useTokens'
import type { Address } from 'viem'

export default function TokenInput({
  label, onChange,
}: { label: string; onChange: (addr: Address) => void }) {
  const { tokens } = useTokens()
  const [q, setQ] = useState('')

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return tokens.slice(0, 10)
    return tokens.filter(t =>
      t.symbol.toLowerCase().includes(query) ||
      t.name.toLowerCase().includes(query) ||
      t.address.toLowerCase() === query
    ).slice(0, 20)
  }, [q, tokens])

  const select = (addr: string) => {
    onChange(addr as Address)
    setQ(addr)
  }

  const isHexAddr = /^0x[a-f0-9]{40}$/.test(q.trim().toLowerCase())

  return (
    <div className="space-y-1">
      <div className="text-xs opacity-70">{label}</div>
      <input
        className="w-full bg-neutral-800 p-2 rounded"
        placeholder="Search symbol/name or paste address"
        value={q}
        onChange={(e)=> setQ(e.target.value)}
        onBlur={() => { if (isHexAddr) select(q.trim()) }}
      />
      {/* Suggestions */}
      {results.length > 0 && (
        <div className="max-h-56 overflow-auto bg-neutral-900 rounded border border-neutral-800">
          {results.map(t => (
            <button
              key={t.address}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-800 text-left"
              onClick={() => select(t.address)}
              type="button"
            >
              {/* token logo */}
              {t.logoURI ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.logoURI} alt={t.symbol} className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-neutral-700" />
              )}
              <div className="flex-1">
                <div className="text-sm">{t.symbol}</div>
                <div className="text-xs opacity-70">{t.name}</div>
              </div>
              <div className="text-[10px] opacity-60">{t.address.slice(0,6)}…{t.address.slice(-4)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}