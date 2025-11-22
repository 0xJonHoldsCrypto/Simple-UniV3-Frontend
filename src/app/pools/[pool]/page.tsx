"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";

import { useTokens } from "@/state/useTokens";
import { getPoolState } from "@/lib/univ3/pools";

// -------- GeckoTerminal API ----------
// Use official GeckoTerminal v2 for pool stats.
// Keep p1 swaps for now (lightweight recent trades) because v2 trades
// endpoints vary by network and are not strictly documented.

// v2 pool response (official)
type GeckoV2PoolAttrs = {
  address?: string;
  name?: string;
  pool_name?: string;
  pool_fee_percentage?: string;
  reserve_in_usd?: string;
  volume_usd?: {
    m5?: string;
    m15?: string;
    m30?: string;
    h1?: string;
    h6?: string;
    h24?: string;
    d7?: string;
  };
  fees_usd?: { h24?: string };
  price_change_percentage?: Record<string, string>;
};

type GeckoV2PoolResponse = {
  data?: {
    id?: string;
    type?: string;
    attributes?: GeckoV2PoolAttrs;
  };
  included?: Array<{
    id?: string;
    type?: string;
    attributes?: any;
  }>;
};

// p1 swaps response (works on app.geckoterminal.com)
type GeckoP1SwapAttrs = {
  block_timestamp?: string;
  tx_hash?: string;
  from_token_amount?: string;
  to_token_amount?: string;
  price_in_usd?: string;
  volume_in_usd?: string;
  kind?: string;
};

type GeckoP1SwapsResponse = {
  data?: Array<{
    id?: string;
    type?: string;
    attributes?: GeckoP1SwapAttrs;
    relationships?: any;
  }>;
};
// v2 OHLCV response (official)
type GeckoV2OhlcvResponse = {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      ohlcv_list?: Array<[number, number, number, number, number, number]>;
    };
  };
  meta?: any;
};
async function fetchGeckoPool(pool: string) {
  const url = `/api/gecko/pool/${encodeURIComponent(pool.toLowerCase())}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Gecko v2 pool fetch failed: ${res.status}${body ? `: ${body}` : ""}`
    );
  }
  return (await res.json()) as GeckoV2PoolResponse;
}
async function fetchGeckoOhlcv(
  pool: string,
  timeframe: "day" | "hour" = "day"
) {
  const qs = new URLSearchParams({
    ohlcv: timeframe,
    aggregate: "1",
    limit: "100",
    currency: "usd",
    include_empty_intervals: "false",
    token: "base",
  });
  const url = `/api/gecko/pool/${encodeURIComponent(
    pool.toLowerCase()
  )}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Gecko v2 ohlcv fetch failed: ${res.status}${body ? `: ${body}` : ""}`
    );
  }
  return (await res.json()) as GeckoV2OhlcvResponse;
}
async function fetchGeckoSwaps(pool: string) {
  const url = `/api/gecko/swaps/${encodeURIComponent(pool.toLowerCase())}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Gecko p1 swaps fetch failed: ${res.status}${body ? `: ${body}` : ""}`
    );
  }
  return (await res.json()) as GeckoP1SwapsResponse;
}

function toNum(v: string | undefined | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type PoolState = {
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
};

// -------- helpers ----------

const shortAddr = (a?: string | null) =>
  a ? `${a.slice(0, 12)}…${a.slice(-8)}` : "—";

// token1 per token0 from sqrtPriceX96
function priceFromSqrtPriceX96(sqrtX96: bigint, dec0: number, dec1: number) {
  if (sqrtX96 <= 0n) return NaN;
  const num = sqrtX96 * sqrtX96; // Q192
  const Q192 = 2n ** 192n;
  const ratio = Number(num) / Number(Q192); // raw token1/token0
  if (!Number.isFinite(ratio) || ratio <= 0) return NaN;
  return ratio * Math.pow(10, dec0 - dec1);
}

function formatPrice(p: number | null, decimals = 6) {
  if (p == null || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-6)) return p.toExponential(4);
  return p.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}

function feeLabel(fee: number) {
  return `${(fee / 10_000).toFixed(2)}%`;
}

const poolAbi = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "fee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint24" }],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "tickSpacing",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "int24" }],
  },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

// -------- page ----------

export default function PoolPage() {
  const params = useParams<{ pool: string }>();
  const poolAddress = (params?.pool ?? "") as Address;

  const publicClient = usePublicClient();
  const { byAddr } = useTokens();

  const [state, setState] = useState<PoolState | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [gecko, setGecko] = useState<GeckoV2PoolResponse | null>(null);
  const [geckoErr, setGeckoErr] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<GeckoP1SwapsResponse | null>(null);
  const [swapsErr, setSwapsErr] = useState<string | null>(null);
  const [ohlcv, setOhlcv] = useState<GeckoV2OhlcvResponse | null>(null);
  const [ohlcvErr, setOhlcvErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!publicClient || !poolAddress) return;
      setLoading(true);
      setErr(null);
      try {
        const s = await getPoolState(publicClient as any, poolAddress);
        if (!active) return;

        // Some RPCs / helpers omit token0/token1, so fall back to direct pool reads.
        const [t0, t1, feeRaw, liqRaw, spacingRaw, slot0Raw] =
          await Promise.all([
            (s as any)?.token0
              ? Promise.resolve((s as any).token0)
              : publicClient.readContract({
                  address: poolAddress,
                  abi: poolAbi,
                  functionName: "token0",
                }),
            (s as any)?.token1
              ? Promise.resolve((s as any).token1)
              : publicClient.readContract({
                  address: poolAddress,
                  abi: poolAbi,
                  functionName: "token1",
                }),
            (s as any)?.fee != null
              ? Promise.resolve((s as any).fee)
              : publicClient.readContract({
                  address: poolAddress,
                  abi: poolAbi,
                  functionName: "fee",
                }),
            (s as any)?.liquidity != null
              ? Promise.resolve((s as any).liquidity)
              : publicClient.readContract({
                  address: poolAddress,
                  abi: poolAbi,
                  functionName: "liquidity",
                }),
            (s as any)?.tickSpacing != null
              ? Promise.resolve((s as any).tickSpacing)
              : publicClient.readContract({
                  address: poolAddress,
                  abi: poolAbi,
                  functionName: "tickSpacing",
                }),
            (s as any)?.slot0 ??
              publicClient.readContract({
                address: poolAddress,
                abi: poolAbi,
                functionName: "slot0",
              }),
          ]);

        const token0 = t0 as Address;
        const token1 = t1 as Address;
        if (!token0 || !token1)
          throw new Error("Pool state missing token0/token1");

        const slot0 = Array.isArray(slot0Raw) ? slot0Raw : (slot0Raw as any);

        const sqrtPriceX96 = BigInt(
          (s as any)?.sqrtPriceX96 ??
            (slot0 as any)?.sqrtPriceX96 ??
            (slot0 as any)?.[0] ??
            0
        );
        const tick = Number(
          (s as any)?.tick ?? (slot0 as any)?.tick ?? (slot0 as any)?.[1] ?? 0
        );

        setState({
          token0,
          token1,
          fee: Number(feeRaw),
          liquidity: BigInt(liqRaw ?? 0),
          tickSpacing: Number(spacingRaw),
          sqrtPriceX96,
          tick,
        });
      } catch (e: any) {
        if (!active) return;
        setErr(e?.message || "Failed to load pool");
        setState(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [publicClient, poolAddress]);

  // Fetch GeckoTerminal stats (v2) + swaps (p1)
  useEffect(() => {
    let active = true;
    const poolStr = String(poolAddress || "");
    if (!poolStr || poolStr.length !== 42 || !poolStr.startsWith("0x")) return;

    setGeckoErr(null);
    setSwapsErr(null);

    (async () => {
      try {
        const poolJson = await fetchGeckoPool(poolStr);
        if (!active) return;
        setGecko(poolJson ?? null);
        setGeckoErr(null);
      } catch (e: any) {
        if (!active) return;
        setGecko(null);
        setGeckoErr(e?.message || "Failed to load GeckoTerminal pool stats");
      }

      try {
        const ohlcvJson = await fetchGeckoOhlcv(poolStr, "day");
        if (!active) return;
        setOhlcv(ohlcvJson ?? null);
        setOhlcvErr(null);
      } catch (e: any) {
        if (!active) return;
        setOhlcv(null);
        setOhlcvErr(e?.message || "Failed to load GeckoTerminal candles");
      }

      try {
        const swapsJson = await fetchGeckoSwaps(poolStr);
        if (!active) return;
        setSwaps(swapsJson ?? null);
        setSwapsErr(null);
      } catch (e: any) {
        if (!active) return;
        setSwaps(null);
        setSwapsErr(e?.message || "Failed to load GeckoTerminal trades");
      }
    })();

    return () => {
      active = false;
    };
  }, [poolAddress]);

  const meta0 = state?.token0
    ? byAddr.get(String(state.token0).toLowerCase())
    : undefined;
  const meta1 = state?.token1
    ? byAddr.get(String(state.token1).toLowerCase())
    : undefined;

  const currentPrice01 = useMemo(() => {
    if (!state || !meta0 || !meta1) return null;
    const dec0 = Number(meta0.decimals ?? 18);
    const dec1 = Number(meta1.decimals ?? 18);
    const p = priceFromSqrtPriceX96(state.sqrtPriceX96, dec0, dec1); // token1 per token0
    return Number.isFinite(p) ? p : null;
  }, [state, meta0, meta1]);

  const currentPrice10 = useMemo(() => {
    if (currentPrice01 == null || currentPrice01 === 0) return null;
    return 1 / currentPrice01;
  }, [currentPrice01]);

  // v1 placeholders until we add candles + indexed volume/fees
  // GeckoTerminal stats (fallback to "—" in UI)
  const geckoAttrs = gecko?.data?.attributes;
  const tvlUsd = toNum(geckoAttrs?.reserve_in_usd);
  const vol24h = toNum(geckoAttrs?.volume_usd?.h24);
  const vol7d = toNum(geckoAttrs?.volume_usd?.d7);
  const fees24h = toNum(geckoAttrs?.fees_usd?.h24);

  if (!poolAddress) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-sm text-neutral-300">
        No pool address provided.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* ---- TOP RIBBON (OKU-style summary) ---- */}
      <div className="bg-neutral-900/70 rounded-2xl p-4 shadow flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          {/* token icons */}
          <div className="flex -space-x-2">
            {meta0?.logoURI ? (
              <img
                src={meta0.logoURI}
                className="w-8 h-8 rounded-full bg-neutral-800"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-neutral-700" />
            )}
            {meta1?.logoURI ? (
              <img
                src={meta1.logoURI}
                className="w-8 h-8 rounded-full bg-neutral-800"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-neutral-700" />
            )}
          </div>

          <div>
            <div className="text-lg font-semibold">
              {meta0?.symbol ?? shortAddr(state?.token0)} /{" "}
              {meta1?.symbol ?? shortAddr(state?.token1)}
              {state && (
                <span className="ml-2 text-sm text-orange-400">
                  {feeLabel(state.fee)}
                </span>
              )}
            </div>

            <div className="text-sm opacity-80">
              {currentPrice01 != null ? (
                <>
                  {formatPrice(currentPrice01, 4)} {meta1?.symbol}/
                  {meta0?.symbol}
                  <span className="mx-2 opacity-50">·</span>
                  {formatPrice(currentPrice10, 6)} {meta0?.symbol}/
                  {meta1?.symbol}
                </>
              ) : (
                "Loading price…"
              )}
            </div>
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-2">
          <Link
            href={`/swap?tokenIn=${state?.token0 ?? ""}&tokenOut=${
              state?.token1 ?? ""
            }&fee=${state?.fee ?? ""}`}
            className="px-4 py-2 rounded-full bg-orange-500/90 hover:bg-orange-500 text-sm font-medium"
          >
            Swap
          </Link>
          <Link
            href={`/add?token0=${state?.token0 ?? ""}&token1=${
              state?.token1 ?? ""
            }&fee=${state?.fee ?? ""}&pool=${poolAddress}`}
            className="px-4 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 text-sm font-medium"
          >
            Add Liquidity
          </Link>
        </div>
      </div>
      {geckoErr && (
        <div className="text-xs text-amber-400">
          Stats may be incomplete: {geckoErr}
        </div>
      )}

      {/* ---- MAIN GRID ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* CENTER: chart + stats */}
        <div className="space-y-4">
          {/* stat cards (OKU-like) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="TVL"
              value={tvlUsd != null ? `$${tvlUsd.toLocaleString()}` : "—"}
            />
            <StatCard
              label="24h Volume"
              value={vol24h != null ? `$${vol24h.toLocaleString()}` : "—"}
            />
            <StatCard
              label="7d Volume"
              value={vol7d != null ? `$${vol7d.toLocaleString()}` : "—"}
            />
            <StatCard
              label="24h Fees"
              value={fees24h != null ? `$${fees24h.toLocaleString()}` : "—"}
            />
          </div>

          {/* chart shell */}
          <div className="bg-neutral-900/70 rounded-2xl p-4 shadow h-[420px] flex flex-col items-center justify-center text-neutral-400 gap-2">
            <div>Chart coming next (candles + liquidity overlays).</div>

            {ohlcvErr && (
              <div className="text-xs text-amber-400">
                Candles may be incomplete: {ohlcvErr}
              </div>
            )}

            {ohlcv?.data?.attributes?.ohlcv_list && (
              <div className="text-xs opacity-70">
                Candles loaded: {ohlcv.data.attributes.ohlcv_list.length}
              </div>
            )}
          </div>

          {/* bottom tabs */}
          <div className="bg-neutral-900/70 rounded-2xl p-4 shadow">
            <div className="flex gap-3 text-sm mb-3">
              <Tab active>Swaps</Tab>
              <Tab>Liquidity</Tab>
              <Tab>Positions</Tab>
              <Tab>Info</Tab>
            </div>

            <div className="text-sm text-neutral-400">
              Hook these tabs to on-chain event feeds / indexed data.
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR (like OKU pool list / recent tx) */}
        <div className="space-y-4">
          <div className="bg-neutral-900/70 rounded-2xl p-4 shadow">
            <div className="text-sm font-semibold mb-2">Pool Info</div>
            <div className="text-xs space-y-2 text-neutral-300">
              <Row
                label="Pool Address"
                value={
                  <div className="flex items-center gap-2 min-w-0 justify-end">
                    <a
                      href={`https://explorer.hemi.xyz/address/${poolAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:opacity-90 font-mono text-orange-400 text-[11px] sm:text-xs whitespace-nowrap"
                      title={poolAddress}
                    >
                      {shortAddr(poolAddress)}
                    </a>
                    <CopyAddressButton text={poolAddress} />
                  </div>
                }
              />
              <Row label="Fee Tier" value={state ? feeLabel(state.fee) : "—"} />
              <Row label="Tick" value={state ? String(state.tick) : "—"} />
              <Row
                label="Tick Spacing"
                value={state ? String(state.tickSpacing) : "—"}
              />
              <Row
                label="Liquidity"
                value={state ? state.liquidity.toString() : "—"}
              />
            </div>
          </div>

          <div className="bg-neutral-900/70 rounded-2xl p-4 shadow">
            <div className="text-sm font-semibold mb-2">Recent Trades</div>

            {swapsErr && (
              <div className="text-xs text-amber-400 mb-2">
                Trades may be incomplete: {swapsErr}
              </div>
            )}

            <div className="text-xs text-neutral-300 space-y-2">
              {(swaps?.data ?? []).slice(0, 10).map((s, i) => {
                const a = s.attributes;
                const ts = a?.block_timestamp
                  ? new Date(a.block_timestamp).toLocaleString()
                  : "—";
                const fromAmt = a?.from_token_amount
                  ? Number(a.from_token_amount)
                  : null;
                const toAmt = a?.to_token_amount
                  ? Number(a.to_token_amount)
                  : null;
                const usd = a?.volume_in_usd ? Number(a.volume_in_usd) : null;
                const kind = a?.kind ?? "";

                return (
                  <div
                    key={s.id ?? i}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate">
                        {kind ? kind.toUpperCase() : "SWAP"}{" "}
                        {fromAmt != null && meta0?.symbol
                          ? `${fromAmt.toFixed(4)} ${meta0.symbol}`
                          : "—"}
                        {" → "}
                        {toAmt != null && meta1?.symbol
                          ? `${toAmt.toFixed(4)} ${meta1.symbol}`
                          : "—"}
                      </div>
                      <div className="text-[11px] opacity-60">{ts}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-orange-300">
                        {usd != null && Number.isFinite(usd)
                          ? `$${usd.toFixed(2)}`
                          : "—"}
                      </div>
                      {a?.tx_hash && (
                        <a
                          href={`https://explorer.hemi.xyz/tx/${a.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] underline opacity-70 hover:opacity-100"
                        >
                          View
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}

              {(!swaps?.data || swaps.data.length === 0) && (
                <div className="text-xs text-neutral-400">
                  No recent trades yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="text-sm opacity-70">Loading…</div>}
      {err && <div className="text-sm text-red-400">{err}</div>}
      {swapsErr && !err && (
        <div className="text-xs text-amber-400">
          Trades may be incomplete: {swapsErr}
        </div>
      )}
    </div>
  );
}

// ----- tiny UI components -----

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900/70 rounded-xl p-3 shadow">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div className="text-lg font-semibold text-orange-300">{value}</div>
    </div>
  );
}

function Tab({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={`px-3 py-1 rounded-full text-xs ${
        active
          ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40"
          : "bg-neutral-800 hover:bg-neutral-700"
      }`}
      type="button"
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="opacity-70 shrink-0">{label}</span>
      <span className="text-right text-orange-300 min-w-0 flex-1 flex justify-end">
        {value}
      </span>
    </div>
  );
}

function CopyAddressButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label="Copy full address"
      title="Copy full address"
      onClick={() => {
        try {
          navigator.clipboard?.writeText(text);
        } catch (e) {
          console.warn("Copy failed", e);
        }
      }}
      className="shrink-0 rounded-md bg-neutral-800 px-2 py-1 text-[11px] leading-none text-neutral-200 hover:text-orange-300 hover:bg-neutral-700 transition"
    >
      ⧉
    </button>
  );
}
