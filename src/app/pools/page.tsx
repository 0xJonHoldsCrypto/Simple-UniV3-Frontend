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

const formatUsdCompact = (usd?: number | null) => {
  if (usd == null || !Number.isFinite(usd)) return "—";
  const abs = Math.abs(usd);
  if (abs >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`;
  return usd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usd < 1 ? 6 : usd < 100 ? 2 : 0,
  });
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

const getSessionCache = <T,>(key: string, maxAgeMs: number): T | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; v: T };
    if (!parsed?.t) return null;
    if (Date.now() - parsed.t > maxAgeMs) return null;
    return parsed.v;
  } catch {
    return null;
  }
};

const setSessionCache = (key: string, v: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    // ignore cache write errors
  }
};

// --- page ------------------------------------------------------

export default function PoolsPage() {
  const { byAddr } = useTokens();
  const router = useRouter();
  const [rows, setRows] = useState<RawPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tvlUsdByPool, setTvlUsdByPool] = useState<Record<string, number>>({});
  const [tvlSourceByPool, setTvlSourceByPool] = useState<
    Record<string, string>
  >({});

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

  useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;

    (async () => {
      const next: Record<string, number> = {};
      const nextSrc: Record<string, string> = {};

      await Promise.allSettled(
        rows.map(async (r) => {
          const key = r.pool.toLowerCase();
          try {
            // ---- 1) Gecko pool endpoint (short cache ~60s)
            const geckoCacheKey = `gecko:tvl:${key}`;
            const cachedGecko = getSessionCache<any>(geckoCacheKey, 60_000);

            let geckoJson: any | null = cachedGecko;
            if (!geckoJson) {
              const res = await fetch(`/api/gecko/pool/${r.pool}`);
              if (res.ok) {
                geckoJson = await res.json();
                setSessionCache(geckoCacheKey, geckoJson);
              }
            }

            const attrs = geckoJson?.data?.attributes;
            if (attrs) {
              const reserveUsd = Number(attrs.reserve_in_usd);
              const baseLiqUsd = Number(attrs.base_token_liquidity_usd);
              const quoteLiqUsd = Number(attrs.quote_token_liquidity_usd);
              const tvl = Number.isFinite(reserveUsd)
                ? reserveUsd
                : (Number.isFinite(baseLiqUsd) ? baseLiqUsd : 0) +
                  (Number.isFinite(quoteLiqUsd) ? quoteLiqUsd : 0);

              if (Number.isFinite(tvl) && tvl > 0) {
                next[key] = tvl;
                nextSrc[key] = "gecko";
                return;
              }
            }

            // ---- 2) Fallback on-chain TVL (longer cache ~30m)
            const fbCacheKey = `fb:tvl:${key}`;
            const cachedFb = getSessionCache<any>(fbCacheKey, 30 * 60_000);

            let fbJson: any | null = cachedFb;
            if (!fbJson) {
              const fb = await fetch(`/api/pools/tvl/${r.pool}`);
              if (!fb.ok) return;
              fbJson = await fb.json();
              setSessionCache(fbCacheKey, fbJson);
            }

            const tvlUsd = Number(fbJson?.tvlUsd);
            if (Number.isFinite(tvlUsd) && tvlUsd > 0) {
              next[key] = tvlUsd;
              nextSrc[key] = fbJson?.source || "onchain";
            }
          } catch {
            // ignore
          }
        })
      );

      if (!cancelled) {
        setTvlUsdByPool((prev) => ({ ...prev, ...next }));
        setTvlSourceByPool((prev) => ({ ...prev, ...nextSrc }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rows]);

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const key = r.pool.toLowerCase();
        return {
          ...r,
          t0: byAddr.get(r.token0.toLowerCase()),
          t1: byAddr.get(r.token1.toLowerCase()),
          liqBig: liquidityBigInt(r.liquidity),
          tvlUsd: tvlUsdByPool[key] ?? 0,
          tvlSource: tvlSourceByPool[key] ?? null,
        };
      }),
    [rows, byAddr, tvlUsdByPool, tvlSourceByPool]
  );

  const sorted = useMemo(() => {
    const nonZero = enriched.filter((r: any) => (r.tvlUsd ?? 0) > 0);
    const zero = enriched.filter((r: any) => (r.tvlUsd ?? 0) === 0);

    nonZero.sort((a: any, b: any) => {
      if (a.tvlUsd === b.tvlUsd) return 0;
      return a.tvlUsd > b.tvlUsd ? -1 : 1;
    });

    // For unpriced pools, sort by raw liquidity BigInt desc
    zero.sort((a: any, b: any) => {
      const la = a.liqBig ?? 0n;
      const lb = b.liqBig ?? 0n;
      if (la === lb) return 0;
      return la > lb ? -1 : 1;
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

                {(() => {
                  const isGecko =
                    r.tvlUsd && r.tvlUsd > 0 && r.tvlSource === "gecko";
                  const isEstimated =
                    r.tvlUsd &&
                    r.tvlUsd > 0 &&
                    r.tvlSource &&
                    r.tvlSource !== "gecko";
                  const isMissing = !r.tvlUsd || r.tvlUsd <= 0;

                  const title = isGecko
                    ? `TVL from GeckoTerminal: ${formatUsdCompact(r.tvlUsd)}`
                    : isEstimated
                    ? `Estimated TVL (${r.tvlSource}): ${formatUsdCompact(
                        r.tvlUsd
                      )}`
                    : `No price data available yet. Showing raw liquidity: ${
                        r.liquidity ?? "0"
                      }`;

                  return (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {/* source badge slot (fixed width so all rows align) */}
                        <span className="w-5 shrink-0 flex justify-start">
                          {isGecko ? (
                            <img
                              src="/geckoterminal.svg"
                              alt="GeckoTerminal"
                              title="GeckoTerminal"
                              className="w-4 h-4 opacity-90"
                            />
                          ) : isEstimated ? (
                            <span
                              className="inline-flex items-center justify-center w-4 h-4 rounded bg-neutral-800 text-neutral-200 text-[10px] border border-neutral-700"
                              title={`On-chain estimate (${r.tvlSource})`}
                            >
                              🔗
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-4 h-4" />
                          )}
                        </span>

                        {/* value */}
                        <span
                          className={
                            isGecko
                              ? "text-orange-300"
                              : isEstimated
                              ? "text-white"
                              : "text-neutral-400"
                          }
                        >
                          {isGecko || isEstimated
                            ? formatUsdCompact(r.tvlUsd)
                            : formatLiquidityCompact(r.liquidity)}
                        </span>

                        {/* optional NA badge (right side) */}
                      </div>
                    </td>
                  );
                })()}
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
