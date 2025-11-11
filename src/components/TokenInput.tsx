'use client'
import { useState } from 'react'
import type { Address } from 'viem'

export default function TokenInput({ label, onChange }:{ label:string; onChange:(addr:Address)=>void }){
  const [v, setV] = useState('')
  return (
    <div className="space-y-1">
      <div className="text-xs opacity-70">{label}</div>
      <input
        className="w-full bg-neutral-800 p-2 rounded"
        placeholder="0x token address"
        value={v}
        onChange={(e)=>{ const val = e.target.value; setV(val); onChange(val as Address) }}
      />
    </div>
  )
}