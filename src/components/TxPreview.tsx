export default function TxPreview({
  rows,
}: {
  rows: { k: string; v: string }[];
}) {
  return (
    <div className="text-xs bg-neutral-900 rounded p-3 space-y-1">
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between">
          <span className="opacity-70">{r.k}</span>
          <span>{r.v}</span>
        </div>
      ))}
    </div>
  );
}
