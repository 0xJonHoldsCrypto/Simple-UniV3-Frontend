'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { useTokens } from '@/state/useTokens'

type Props = {
  label: string
  value?: Address
  onChange: (addr: Address) => void
}

export default function TokenInput({ label, value, onChange }: Props) {
  const { tokens, byAddr } = useTokens()
  const [q, setQ] = useState('')

  // Display the selected token’s symbol when value changes
  useEffect(() => {
    if (!value) return setQ('')
    const t = byAddr.get(value.toLowerCase())
    setQ(t ? t.symbol : value)
  }, [value, byAddr])

  const isHexAddr = /^0x[a-f0-9]{40}$/.test(q.trim().toLowerCase())

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return tokens.slice(0, 12)
    return tokens.filter(t =>
      t.symbol.toLowerCase().includes(s) ||
      t.name.toLowerCase().includes(s) ||
      t.address.toLowerCase() === s
    ).slice(0, 24)
  }, [q, tokens])

  const select = (addr: string) => {
    onChange(addr as Address)
  }

  return (
    <div className="space-y-1">
      <div className="text-xs opacity-70">{label}</div>
      <input
        className="w-full bg-neutral-800 p-2 rounded"
        placeholder="Search symbol/name or paste 0x…"
        value={q}
        onChange={(e)=> setQ(e.target.value)}
        onBlur={() => { if (isHexAddr) select(q.trim()) }}
      />
      {!!results.length && (
        <div className="max-h-56 overflow-auto bg-neutral-900 rounded border border-neutral-800 mt-1">
          {results.map(t => (
            <button
              key={t.address}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-800 text-left"
              onMouseDown={(e)=> e.preventDefault()}
              onClick={() => select(t.address)}
              type="button"
            >
              {t.logoURI
                ? <img src={t.logoURI} alt={t.symbol} className="w-5 h-5 rounded-full" />
                : <div className="w-5 h-5 rounded-full bg-neutral-700" />
              }
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