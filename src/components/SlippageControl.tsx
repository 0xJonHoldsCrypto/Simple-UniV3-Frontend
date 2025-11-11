'use client'
export default function SlippageControl({ value, onChange }:{ value:number; onChange:(v:number)=>void }){
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="opacity-70">Slippage</span>
      <input className="w-24 bg-neutral-800 p-2 rounded" value={value} onChange={(e)=>onChange(Number(e.target.value))} />
      <span className="opacity-70">bps</span>
    </div>
  )
}