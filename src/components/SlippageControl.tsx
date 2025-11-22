"use client";
type Props = { value: number; onChange: (bps: number) => void };

export default function SlippageControl({ value, onChange }: Props) {
  const pct = (value / 100).toFixed(2);

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="opacity-70">Slippage</span>
      <input
        className="w-24 bg-neutral-800 p-2 rounded"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value || 0);
          const clamped = Math.max(0, Math.min(5000, Math.floor(n))); // 0–50%
          onChange(clamped);
        }}
        aria-label="Slippage (bps)"
        title="Slippage (basis points)"
      />
      <span className="opacity-70">bps ({pct}%)</span>
      <div className="flex gap-1">
        {[25, 50, 100].map((b) => (
          <button
            key={b}
            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            onClick={() => onChange(b)}
          >
            {(b / 100).toFixed(2)}%
          </button>
        ))}
      </div>
    </div>
  );
}
