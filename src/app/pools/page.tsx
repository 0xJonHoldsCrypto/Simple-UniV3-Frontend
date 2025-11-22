"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTokens } from "@/state/useTokens";

export type RawPool = {
  pool: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  liquidity: string;
  slot0?: {
    sqrtPriceX96: string;
    tick: number;
  } | null;
};

// --- helpers ---------------------------------------------------

const shortAddr = (a?: string | null) => {
  if (!a) return "-";
  if (a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
};

const formatLiquidityCompact = (liq?: string | null) => {
  if (!liq) return "0";
  try {
    const big = BigInt(liq);
    if (big === 0n) return "0";

    // Convert to a compact, human-friendly number.
    // NOTE: Uniswap V3 `liquidity` is a raw liquidity value, not token amounts.
    const units = ["", "K", "M", "B", "T", "P", "E"];
    let unitIndex = 0;
    let value = big;

    while (value >= 1000n && unitIndex < units.length - 1) {
      value /= 1000n;
      unitIndex++;
    }

    // For more precision, compute a 2-decimal float using the original BigInt.
    const denom = 1000n ** BigInt(unitIndex);
    const num = Number(big) / Number(denom);
    if (!Number.isFinite(num)) return big.toString();

    return `${num.toLocaleString(undefined, {
      maximumFractionDigits: num < 10 ? 3 : 2,
      minimumFractionDigits: 0,
    })}${units[unitIndex]}`;
  } catch {
    return liq;
  }
};

const liquidityBigInt = (liq?: string | null) => {
  try {
    return liq ? BigInt(liq) : 0n;
  } catch {
    return 0n;
  }
};

// --- page ------------------------------------------------------

export default function PoolsPage() {
  const { byAddr } = useTokens();
  const router = useRouter();
  const [rows, setRows] = useState<RawPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(refresh = false) {
    setError(null);
    setLoading(true);
    try {
      const url = refresh ? "/api/pools?refresh=1" : "/api/pools";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RawPool[];

      // filter out any diag/summary/malformed entries
      const valid = data.filter(
        (r) =>
          r &&
          typeof r.pool === "string" &&
          r.pool.startsWith("0x") &&
          r.token0 &&
          r.token1
      );

      setRows(valid);
    } catch (e: any) {
      setError(e?.message || "Failed to load pools");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        t0: byAddr.get(r.token0.toLowerCase()),
        t1: byAddr.get(r.token1.toLowerCase()),
        liqBig: liquidityBigInt(r.liquidity),
      })),
    [rows, byAddr]
  );

  const sorted = useMemo(() => {
    const nonZero = enriched.filter((r: any) => r.liqBig > 0n);
    const zero = enriched.filter((r: any) => r.liqBig === 0n);

    nonZero.sort((a: any, b: any) => {
      if (a.liqBig === b.liqBig) return 0;
      return a.liqBig > b.liqBig ? -1 : 1;
    });

    return [...nonZero, ...zero];
  }, [enriched]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between bg-neutral-900/70 rounded-2xl p-4 shadow">
        <h1 className="text-3xl font-semibold">Pools</h1>
        <button
          className="px-4 py-2 rounded-full bg-orange-500/90 hover:bg-orange-500 text-sm font-medium"
          onClick={() => load(true)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900/80">
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-2">Pool</th>
              <th className="px-4 py-2">Pair</th>
              <th className="px-4 py-2">Fee</th>
              <th className="px-4 py-2">Tick</th>
              <th className="px-4 py-2">Tick Spacing</th>
              <th className="px-4 py-2">Liquidity</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && !loading && !error && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  No pools found.
                </td>
              </tr>
            )}

            {sorted.map((r: any) => (
              <tr
                key={`${r.pool}-${r.fee}`}
                className="border-t border-neutral-800 hover:bg-neutral-900/60 transition-colors cursor-pointer"
                onClick={() => router.push(`/pools/${r.pool}`)}
              >
                {/* Pool address */}
                <td className="px-4 py-2 font-mono">
                  {r.pool ? (
                    <a
                      href={`https://explorer.hemi.xyz/address/${r.pool}`}
                      target="_blank"
                      rel="noreferrer"
                      title={r.pool}
                      className="underline hover:opacity-80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {shortAddr(r.pool)}
                    </a>
                  ) : (
                    "-"
                  )}
                </td>

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
                    : "-"}
                </td>

                {/* Tick */}
                <td className="px-4 py-2">{r.slot0 ? r.slot0.tick : "-"}</td>

                {/* Tick spacing */}
                <td className="px-4 py-2">{r.tickSpacing}</td>

                {/* Liquidity */}
                <td className="px-4 py-2" title={r.liquidity ?? "0"}>
                  {formatLiquidityCompact(r.liquidity)}
                </td>

                {/* Actions */}
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/add?token0=${r.token0}&token1=${r.token1}&fee=${r.fee}&pool=${r.pool}`}
                      className="px-3 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Add
                    </Link>
                    <Link
                      href={`/pools/${r.pool}`}
                      className="px-3 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Stats
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
