"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { useAccount, useBalance, usePublicClient } from "wagmi";

import { useTokens } from "@/state/useTokens";
import { getPoolState } from "@/lib/univ3/pools";
import { PoolChart } from "@/components/PoolChart";

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
  created_at?: string; // not always present, best-effort
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
type OhlcvCfg = {
  timeframe: "minute" | "hour" | "day" | "second";
  aggregate: string;
  limit: string;
};

async function fetchGeckoOhlcv(
  pool: string,
  cfg: OhlcvCfg,
  tokenSide: "base" | "quote" = "base"
) {
  const qs = new URLSearchParams({
    timeframe: cfg.timeframe,
    aggregate: cfg.aggregate,
    limit: cfg.limit,
    currency: "usd",
    include_empty_intervals: "false",
    token: tokenSide,
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

function looksStableSeries(
  list?: Array<[number, number, number, number, number, number]>
) {
  if (!list?.length) return false;
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const closes = sorted.map((r) => Number(r[4])).filter(Number.isFinite);
  if (closes.length < 5) return false;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const mid = (min + max) / 2;

  // stablecoins hover ~1 USD with very low range
  return mid > 0.97 && mid < 1.03 && max - min < 0.05;
}

const stableSyms = new Set(["USDC", "USDC.E", "USDT", "DAI"]);

const TF_OPTIONS = [
  {
    key: "m15",
    label: "15m",
    cfg: { timeframe: "minute", aggregate: "15", limit: "300" },
  },
  {
    key: "h1",
    label: "1H",
    cfg: { timeframe: "hour", aggregate: "1", limit: "300" },
  },
  {
    key: "h4",
    label: "4H",
    cfg: { timeframe: "hour", aggregate: "4", limit: "300" },
  },
  {
    key: "d1",
    label: "1D",
    cfg: { timeframe: "day", aggregate: "1", limit: "300" },
  },
  {
    key: "w1",
    label: "1W",
    cfg: { timeframe: "day", aggregate: "7", limit: "200" },
  },
] as const;

type TfKey = (typeof TF_OPTIONS)[number]["key"];

function sumVolumeUSD(
  list?: Array<[number, number, number, number, number, number]>,
  bars = 7
) {
  if (!list?.length) return null;
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const slice = sorted.slice(-bars);
  const total = slice.reduce((acc, c) => acc + Number(c[5] ?? 0), 0);
  return Number.isFinite(total) ? total : null;
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
  const [chartSide, setChartSide] = useState<"base" | "quote">("base");
  const [sideTouched, setSideTouched] = useState(false);
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

  const [tfKey, setTfKey] = useState<TfKey>("d1");
  const [disabledTfs, setDisabledTfs] = useState<Set<TfKey>>(new Set());
  const tfCfg = TF_OPTIONS.find((t) => t.key === tfKey)!.cfg;
  type TabKey = "swaps" | "liquidity" | "positions" | "info";
  const [activeTab, setActiveTab] = useState<TabKey>("swaps");

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
        const ohlcvJson = await fetchGeckoOhlcv(poolStr, tfCfg, chartSide);
        if (!active) return;
        // If Gecko says this TF isn't indexed, hide it and pick a fallback.
        if ((ohlcvJson as any)?.meta?.not_indexed || !ohlcvJson?.data) {
          setDisabledTfs((prev) => {
            const next = new Set(prev);
            next.add(tfKey);
            return next;
          });

          // Prefer d1, then h4, h1, m15
          const ordered: TfKey[] = ["d1", "h4", "h1", "m15", "w1"];
          const fallback = ordered.find(
            (k) => k !== tfKey && !disabledTfs.has(k)
          );
          if (fallback) setTfKey(fallback);

          setOhlcv(null);
          setOhlcvErr("Timeframe not indexed on GeckoTerminal yet.");
          return;
        }
        const list = ohlcvJson?.data?.attributes?.ohlcv_list;

        // base looks stable (~$1) AND user hasn't touched toggles
        // => flip once to quote to show the volatile asset by default.
        if (!sideTouched && chartSide === "base" && looksStableSeries(list)) {
          setChartSide("quote");
          return; // let effect re-run with quote side
        }

        setOhlcv(ohlcvJson ?? null);
        setOhlcvErr(null);
      } catch (e: any) {
        if (!active) return;

        const msg = String(e?.message || "");

        // If this timeframe isn't supported/indexed yet, hide it and fall back.
        if (
          msg.includes("Invalid timeframe") ||
          msg.includes("not indexed") ||
          msg.includes("Gecko 400") ||
          msg.includes("Gecko 404")
        ) {
          setDisabledTfs((prev) => {
            const next = new Set(prev);
            next.add(tfKey);
            return next;
          });

          // fallback order (don’t rely on disabledTfs closure here)
          const ordered: TfKey[] = ["d1", "h4", "h1", "m15", "w1"];
          const fallback = ordered.find((k) => k !== tfKey);
          if (fallback) setTfKey(fallback);

          setOhlcv(null);
          setOhlcvErr("Timeframe not indexed on GeckoTerminal yet.");
          return;
        }

        setOhlcv(null);
        setOhlcvErr(msg || "Failed to load GeckoTerminal candles");
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
  }, [poolAddress, tfKey, chartSide]);

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

  const ohlcvList = ohlcv?.data?.attributes?.ohlcv_list;
  const vol7dFallback =
    tfCfg.timeframe === "day"
      ? sumVolumeUSD(ohlcvList, 7)
      : tfCfg.timeframe === "hour"
      ? sumVolumeUSD(ohlcvList, 24 * 7)
      : null;

  const feeTierPct = state ? state.fee / 1_000_000 : null; // 500 => 0.0005
  const fees24hFallback =
    vol24h != null && feeTierPct != null ? vol24h * feeTierPct : null;

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
              value={
                vol7d != null
                  ? `$${vol7d.toLocaleString()}`
                  : vol7dFallback != null
                  ? `$${vol7dFallback.toLocaleString()}`
                  : "—"
              }
            />
            <StatCard
              label="24h Fees"
              value={
                fees24h != null
                  ? `$${fees24h.toLocaleString()}`
                  : fees24hFallback != null
                  ? `~$${fees24hFallback.toLocaleString()}`
                  : "—"
              }
            />
          </div>

          {/* chart */}
          <div className="bg-neutral-900/70 rounded-2xl p-4 shadow h-[420px] flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold text-neutral-200">
                Price ({TF_OPTIONS.find((t) => t.key === tfKey)?.label} candles)
              </div>

              <div className="flex items-center gap-1 text-xs flex-wrap">
                {TF_OPTIONS.map((t) => {
                  const isDisabled = disabledTfs.has(t.key);
                  const isActive = tfKey === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      disabled={isDisabled}
                      title={isDisabled ? "Not indexed yet" : undefined}
                      onClick={() => {
                        if (!isDisabled) setTfKey(t.key);
                      }}
                      className={`px-2 py-1 rounded-full transition ${
                        isDisabled
                          ? "bg-neutral-800/40 text-neutral-500 cursor-not-allowed"
                          : isActive
                          ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40"
                          : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}

                <div className="w-px h-4 bg-neutral-700 mx-1" />

                <button
                  type="button"
                  onClick={() => {
                    setSideTouched(true);
                    setChartSide("quote");
                  }}
                  className={`px-2 py-1 rounded-full ${
                    chartSide === "quote"
                      ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  }`}
                >
                  {meta0?.symbol ?? "Base"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSideTouched(true);
                    setChartSide("base");
                  }}
                  className={`px-2 py-1 rounded-full ${
                    chartSide === "base"
                      ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  }`}
                >
                  {meta1?.symbol ?? "Quote"}
                </button>
              </div>
            </div>

            {ohlcvErr && (
              <div className="text-xs text-amber-400">
                Candles may be incomplete: {ohlcvErr}
              </div>
            )}

            {ohlcv?.data?.attributes?.ohlcv_list?.length ? (
              <PoolChart ohlcv={ohlcv.data.attributes.ohlcv_list} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
                Loading candles…
              </div>
            )}
          </div>

          {/* bottom tabs */}
          <div className="bg-neutral-900/70 rounded-2xl p-4 shadow">
            <div className="flex gap-2 text-sm mb-3 flex-wrap">
              <Tab
                active={activeTab === "swaps"}
                onClick={() => setActiveTab("swaps")}
              >
                Swaps
              </Tab>
              <Tab
                active={activeTab === "liquidity"}
                onClick={() => setActiveTab("liquidity")}
              >
                Liquidity
              </Tab>
              <Tab
                active={activeTab === "positions"}
                onClick={() => setActiveTab("positions")}
              >
                Positions
              </Tab>
              <Tab
                active={activeTab === "info"}
                onClick={() => setActiveTab("info")}
              >
                Info
              </Tab>
            </div>

            {activeTab === "swaps" && (
              <SwapsPanel
                swaps={swaps}
                swapsErr={swapsErr}
                meta0={meta0}
                meta1={meta1}
              />
            )}

            {activeTab === "liquidity" && (
              <LiquidityPanel poolAddress={poolAddress} state={state} />
            )}

            {activeTab === "positions" && (
              <PositionsPanel poolAddress={poolAddress} />
            )}

            {activeTab === "info" && (
              <InfoPanel
                poolAddress={poolAddress}
                state={state}
                gecko={gecko}
                meta0={meta0}
                meta1={meta1}
                vol7dFallback={vol7dFallback}
                fees24hFallback={fees24hFallback}
              />
            )}
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
                value={state ? state.liquidity.toLocaleString() : "—"}
              />
            </div>
          </div>

          <MiniSwapCard
            poolAddress={poolAddress}
            token0={state?.token0}
            token1={state?.token1}
            fee={state?.fee}
            meta0={meta0}
            meta1={meta1}
            price01={currentPrice01}
            price10={currentPrice10}
          />
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
// ----- right sidebar mini swap -----
function MiniSwapCard({
  poolAddress,
  token0,
  token1,
  fee,
  meta0,
  meta1,
  price01,
  price10,
}: {
  poolAddress: Address;
  token0?: Address;
  token1?: Address;
  fee?: number;
  meta0?: any;
  meta1?: any;
  price01: number | null; // token1 per token0
  price10: number | null; // token0 per token1
}) {
  const [dir, setDir] = useState<"0to1" | "1to0">("0to1");
  const [amountIn, setAmountIn] = useState<string>("");
  const [slippagePct, setSlippagePct] = useState<string>("0.5");

  const { address: userAddress } = useAccount();

  const inToken = dir === "0to1" ? token0 : token1;
  const outToken = dir === "0to1" ? token1 : token0;
  const inMeta = dir === "0to1" ? meta0 : meta1;
  const outMeta = dir === "0to1" ? meta1 : meta0;
  const inSym = inMeta?.symbol ?? shortAddr(inToken);
  const outSym = outMeta?.symbol ?? shortAddr(outToken);

  const inDec = Number(inMeta?.decimals ?? 18);
  const bal = useBalance({
    address: userAddress,
    token: inToken,
    query: { enabled: Boolean(userAddress && inToken) },
  });
  const maxAmountStr =
    bal.data?.value != null ? formatUnits(bal.data.value, inDec) : "";

  const price = dir === "0to1" ? price01 : price10; // out per in
  const feePct = fee != null ? fee / 1_000_000 : 0; // 500 -> 0.0005

  const amtInNum = Number(amountIn);
  const slipNum = Math.max(0, Math.min(100, Number(slippagePct)));

  const amountOutEst =
    Number.isFinite(amtInNum) && amtInNum > 0 && price != null
      ? amtInNum * price * (1 - feePct)
      : null;

  const minOut =
    amountOutEst != null ? amountOutEst * (1 - slipNum / 100) : null;

  const amountQs = amountIn.trim()
    ? `&amountIn=${encodeURIComponent(amountIn.trim())}`
    : "";
  const href = `/swap?tokenIn=${inToken ?? ""}&tokenOut=${outToken ?? ""}&fee=${
    fee ?? ""
  }${amountQs}`;

  return (
    <div className="bg-neutral-900/70 rounded-2xl p-4 shadow space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Quick Swap</div>
        <button
          type="button"
          onClick={() => setDir((d) => (d === "0to1" ? "1to0" : "0to1"))}
          className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition"
          title="Flip direction"
        >
          ⇅ Flip
        </button>
      </div>

      {/* Amount in */}
      <div className="rounded-xl bg-neutral-950/50 p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-neutral-400">
          You pay ({inSym})
        </div>
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            className="w-full bg-transparent text-lg outline-none text-neutral-100 placeholder:text-neutral-600"
          />

          <button
            type="button"
            onClick={() => {
              if (maxAmountStr) setAmountIn(maxAmountStr);
            }}
            className="text-[11px] px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            title={
              maxAmountStr
                ? `Max: ${maxAmountStr} ${inSym}`
                : "Connect wallet to use Max"
            }
            disabled={!maxAmountStr}
          >
            Max
          </button>

          <div className="text-sm font-medium text-neutral-200 shrink-0">
            {inSym}
          </div>
        </div>
      </div>

      {/* Amount out */}
      <div className="rounded-xl bg-neutral-950/50 p-3 space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-neutral-400">
          You receive (est.)
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-lg font-semibold text-neutral-100">
            {amountOutEst != null ? formatPrice(amountOutEst, 6) : "—"}
          </div>
          <div className="text-sm font-medium text-neutral-200">{outSym}</div>
        </div>
        <div className="text-[11px] text-neutral-500">
          Price: {price != null ? formatPrice(price, 6) : "—"} {outSym}/{inSym}
        </div>
      </div>

      {/* Slippage */}
      <div className="flex items-center justify-between rounded-xl bg-neutral-950/50 p-3">
        <div className="text-xs text-neutral-300">Slippage</div>
        <div className="flex items-center gap-1">
          <input
            inputMode="decimal"
            value={slippagePct}
            onChange={(e) => setSlippagePct(e.target.value)}
            className="w-14 bg-neutral-900/60 rounded px-2 py-1 text-xs text-right outline-none"
          />
          <span className="text-xs text-neutral-400">%</span>
        </div>
      </div>

      {/* Summary */}
      <div className="text-xs text-neutral-300 space-y-1">
        <div className="flex justify-between">
          <span className="opacity-70">Fee tier</span>
          <span className="text-orange-300">
            {fee != null ? feeLabel(fee) : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Min received</span>
          <span className="text-orange-300">
            {minOut != null ? `${formatPrice(minOut, 6)} ${outSym}` : "—"}
          </span>
        </div>
      </div>

      {/* Execution CTA */}
      <Link
        href={href}
        className="block text-center px-4 py-2 rounded-full bg-orange-500/90 hover:bg-orange-500 text-sm font-medium"
      >
        Open Swap to Execute
      </Link>

      <div className="text-[11px] text-neutral-500">
        Quotes use current pool price and fee. Exact output may vary with price
        impact.
      </div>
    </div>
  );
}

// ----- bottom tab panels (MVP) -----
function SwapsPanel({
  swaps,
  swapsErr,
  meta0,
  meta1,
}: {
  swaps: GeckoP1SwapsResponse | null;
  swapsErr: string | null;
  meta0?: any;
  meta1?: any;
}) {
  const PAGE_SIZE = 25;
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");

  const all = swaps?.data ?? [];

  const filtered = all.filter((s) => {
    const k = (s.attributes?.kind ?? "").toLowerCase();
    if (filter === "all") return true;
    if (filter === "buy") return k.includes("buy");
    if (filter === "sell") return k.includes("sell");
    return true;
  });

  const rows = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  const sym0 = meta0?.symbol ?? "Token0";
  const sym1 = meta1?.symbol ?? "Token1";

  function relTime(iso?: string) {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "—";
    const diffMs = Date.now() - t;
    const diffSec = Math.floor(diffMs / 1000);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(-diffSec, "second");
    const diffMin = Math.floor(diffSec / 60);
    if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
    const diffHr = Math.floor(diffMin / 60);
    if (Math.abs(diffHr) < 24) return rtf.format(-diffHr, "hour");
    const diffDay = Math.floor(diffHr / 24);
    if (Math.abs(diffDay) < 7) return rtf.format(-diffDay, "day");
    const diffWk = Math.floor(diffDay / 7);
    if (Math.abs(diffWk) < 4) return rtf.format(-diffWk, "week");
    const diffMo = Math.floor(diffDay / 30);
    if (Math.abs(diffMo) < 12) return rtf.format(-diffMo, "month");
    const diffYr = Math.floor(diffDay / 365);
    return rtf.format(-diffYr, "year");
  }

  return (
    <div className="space-y-3">
      {swapsErr && (
        <div className="text-xs text-amber-400">
          Trades may be incomplete: {swapsErr}
        </div>
      )}

      {/* filters */}
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            setFilter("all");
            setVisible(PAGE_SIZE);
          }}
          className={`px-2 py-1 rounded-full ${
            filter === "all"
              ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => {
            setFilter("buy");
            setVisible(PAGE_SIZE);
          }}
          className={`px-2 py-1 rounded-full ${
            filter === "buy"
              ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
          }`}
        >
          Buys
        </button>
        <button
          type="button"
          onClick={() => {
            setFilter("sell");
            setVisible(PAGE_SIZE);
          }}
          className={`px-2 py-1 rounded-full ${
            filter === "sell"
              ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
          }`}
        >
          Sells
        </button>
        <div className="ml-auto opacity-60">{filtered.length} trades</div>
      </div>

      {rows.length === 0 && (
        <div className="text-sm text-neutral-400">No swaps yet.</div>
      )}

      {/* table */}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-neutral-400">
              <tr className="border-b border-neutral-800">
                <th className="text-left py-2 pr-2">Time</th>
                <th className="text-left py-2 pr-2">Side</th>
                <th className="text-right py-2 px-2">{sym0}</th>
                <th className="text-right py-2 px-2">{sym1}</th>
                <th className="text-right py-2 px-2">Price</th>
                <th className="text-right py-2 pl-2">USD</th>
                <th className="text-right py-2 pl-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const a = s.attributes;
                const tsAbs = a?.block_timestamp
                  ? new Date(a.block_timestamp).toLocaleString()
                  : "—";
                const tsRel = relTime(a?.block_timestamp);

                const fromAmt = a?.from_token_amount
                  ? Number(a.from_token_amount)
                  : null;
                const toAmt = a?.to_token_amount
                  ? Number(a.to_token_amount)
                  : null;
                const usd = a?.volume_in_usd ? Number(a.volume_in_usd) : null;
                const kind = (a?.kind ?? "swap").toLowerCase();

                const isBuy = kind.includes("buy");
                const isSell = kind.includes("sell");
                const sideLabel = isBuy ? "BUY" : isSell ? "SELL" : "SWAP";
                const sideCls = isBuy
                  ? "text-emerald-300"
                  : isSell
                  ? "text-red-300"
                  : "text-neutral-300";

                // Gecko p1 swaps don't give explicit token addresses in attrs.
                // Convention: SELL often corresponds to quoting the opposite direction.
                // So for sells we swap displayed columns to keep sym0/sym1 consistent.
                const amt0 =
                  isSell && toAmt != null && fromAmt != null ? toAmt : fromAmt;
                const amt1 =
                  isSell && toAmt != null && fromAmt != null ? fromAmt : toAmt;

                // Prefer explicit USD price if supplied, else derive price from displayed amounts.
                const pxUsd = a?.price_in_usd ? Number(a.price_in_usd) : null;
                const pxDerived =
                  amt0 != null && amt1 != null && amt0 > 0 ? amt1 / amt0 : null;

                return (
                  <tr
                    key={s.id ?? i}
                    className="border-b border-neutral-900/80 hover:bg-neutral-950/40"
                  >
                    <td className="py-2 pr-2 whitespace-nowrap" title={tsAbs}>
                      {tsRel}
                    </td>
                    <td className={`py-2 pr-2 font-semibold ${sideCls}`}>
                      {sideLabel}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {amt0 != null && Number.isFinite(amt0)
                        ? amt0.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })
                        : "—"}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {amt1 != null && Number.isFinite(amt1)
                        ? amt1.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })
                        : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-200 whitespace-nowrap">
                      {pxUsd != null && Number.isFinite(pxUsd)
                        ? `$${formatPrice(pxUsd, 4)}`
                        : pxDerived != null && Number.isFinite(pxDerived)
                        ? formatPrice(pxDerived, 6)
                        : "—"}
                    </td>
                    <td className="py-2 pl-2 text-right text-orange-300">
                      {usd != null && Number.isFinite(usd)
                        ? `$${usd.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}`
                        : "—"}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {a?.tx_hash ? (
                        <a
                          href={`https://explorer.hemi.xyz/tx/${a.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline opacity-70 hover:opacity-100"
                        >
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="px-4 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200"
          >
            Load more
          </button>
        </div>
      )}

      {!hasMore && filtered.length > 0 && (
        <div className="text-[11px] text-neutral-500 text-center">
          End of trades
        </div>
      )}
    </div>
  );
}

function LiquidityPanel({
  poolAddress,
  state,
}: {
  poolAddress: Address;
  state: PoolState | null;
}) {
  return (
    <div className="text-sm text-neutral-400 space-y-2">
      <div>MVP: show recent Mint/Burn/Collect events for this pool.</div>
      <div className="text-xs opacity-70">
        Pool: {shortAddr(poolAddress)} · Fee:{" "}
        {state ? feeLabel(state.fee) : "—"}
      </div>
    </div>
  );
}

function PositionsPanel({ poolAddress }: { poolAddress: Address }) {
  return (
    <div className="text-sm text-neutral-400 space-y-2">
      <div>MVP: wallet-aware positions filtered to this pool.</div>
      <div className="text-xs opacity-70">Pool: {shortAddr(poolAddress)}</div>
    </div>
  );
}

function InfoPanel({
  poolAddress,
  state,
  gecko,
  meta0,
  meta1,
  vol7dFallback,
  fees24hFallback,
}: {
  poolAddress: Address;
  state: PoolState | null;
  gecko: GeckoV2PoolResponse | null;
  meta0?: any;
  meta1?: any;
  vol7dFallback?: number | null;
  fees24hFallback?: number | null;
}) {
  const attrs = gecko?.data?.attributes;

  const tvlUsd = toNum(attrs?.reserve_in_usd);
  const volH24 = toNum(attrs?.volume_usd?.h24);
  const volD7 = toNum(attrs?.volume_usd?.d7);
  const feesH24 = toNum(attrs?.fees_usd?.h24);

  const ch = attrs?.price_change_percentage ?? {};
  const ch5m = toNum(ch.m5);
  const ch1h = toNum(ch.h1);
  const ch6h = toNum(ch.h6);
  const ch24h = toNum(ch.h24);

  const pct = (v: number | null) => {
    if (v == null || !Number.isFinite(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(2)}%`;
  };

  return (
    <div className="space-y-4">
      {/* core facts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-neutral-950/40 rounded-xl p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Pool
          </div>
          <Row label="Address" value={shortAddr(poolAddress)} />
          <Row label="Name" value={attrs?.name ?? attrs?.pool_name ?? "—"} />
          <Row label="Fee Tier" value={state ? feeLabel(state.fee) : "—"} />
          <Row label="Tick" value={state ? String(state.tick) : "—"} />
          <Row
            label="Tick Spacing"
            value={state ? String(state.tickSpacing) : "—"}
          />
          <Row
            label="Liquidity"
            value={state ? state.liquidity.toLocaleString() : "—"}
          />
        </div>

        <div className="bg-neutral-950/40 rounded-xl p-3 space-y-3">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Tokens
          </div>

          {/* Token0 */}
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs opacity-70 shrink-0">Token0</div>
              <div className="text-sm font-semibold text-orange-300 text-right">
                {meta0?.symbol ?? shortAddr(state?.token0)}
              </div>
            </div>
            <div className="w-full font-mono text-[10px] sm:text-[11px] text-neutral-500 break-all">
              {state?.token0 ? String(state.token0) : "—"}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs opacity-70 shrink-0">Decimals</div>
              <div className="text-sm text-orange-300">
                {meta0?.decimals != null ? String(meta0.decimals) : "—"}
              </div>
            </div>
          </div>

          <div className="h-px bg-neutral-800/70" />

          {/* Token1 */}
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs opacity-70 shrink-0">Token1</div>
              <div className="text-sm font-semibold text-orange-300 text-right">
                {meta1?.symbol ?? shortAddr(state?.token1)}
              </div>
            </div>
            <div className="w-full font-mono text-[10px] sm:text-[11px] text-neutral-500 break-all">
              {state?.token1 ? String(state.token1) : "—"}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs opacity-70 shrink-0">Decimals</div>
              <div className="text-sm text-orange-300">
                {meta1?.decimals != null ? String(meta1.decimals) : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* stats */}
      <div className="bg-neutral-950/40 rounded-xl p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-400">
          Stats (GeckoTerminal)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <StatMini
            label="TVL"
            value={tvlUsd != null ? `$${tvlUsd.toLocaleString()}` : "—"}
          />
          <StatMini
            label="24h Vol"
            value={volH24 != null ? `$${volH24.toLocaleString()}` : "—"}
          />
          <StatMini
            label="7d Vol"
            value={
              volD7 != null
                ? `$${volD7.toLocaleString()}`
                : vol7dFallback != null
                ? `$${vol7dFallback.toLocaleString()}`
                : "—"
            }
          />
          <StatMini
            label="24h Fees"
            value={
              feesH24 != null
                ? `$${feesH24.toLocaleString()}`
                : fees24hFallback != null
                ? `~$${fees24hFallback.toLocaleString()}`
                : "—"
            }
          />
        </div>
      </div>

      {/* price change */}
      <div className="bg-neutral-950/40 rounded-xl p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-400">
          Price Change
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <StatMini
            label="5m"
            value={pct(ch5m)}
            valueClass={
              ch5m != null
                ? ch5m >= 0
                  ? "text-emerald-300"
                  : "text-red-300"
                : undefined
            }
          />
          <StatMini
            label="1h"
            value={pct(ch1h)}
            valueClass={
              ch1h != null
                ? ch1h >= 0
                  ? "text-emerald-300"
                  : "text-red-300"
                : undefined
            }
          />
          <StatMini
            label="6h"
            value={pct(ch6h)}
            valueClass={
              ch6h != null
                ? ch6h >= 0
                  ? "text-emerald-300"
                  : "text-red-300"
                : undefined
            }
          />
          <StatMini
            label="24h"
            value={pct(ch24h)}
            valueClass={
              ch24h != null
                ? ch24h >= 0
                  ? "text-emerald-300"
                  : "text-red-300"
                : undefined
            }
          />
        </div>
      </div>

      {/* links */}
      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href={`https://explorer.hemi.xyz/address/${poolAddress}`}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 underline"
        >
          View Pool on Explorer
        </a>
        {attrs?.address && (
          <a
            href={`https://www.geckoterminal.com/hemi-network/pools/${attrs.address}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 underline"
          >
            View on GeckoTerminal
          </a>
        )}
        {state?.token0 && (
          <a
            href={`https://explorer.hemi.xyz/token/${state.token0}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 underline"
          >
            Token0 on Explorer
          </a>
        )}
        {state?.token1 && (
          <a
            href={`https://explorer.hemi.xyz/token/${state.token1}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 underline"
          >
            Token1 on Explorer
          </a>
        )}
      </div>
    </div>
  );
}

// ----- tiny UI components -----

function StatMini({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg bg-neutral-900/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div
        className={`text-sm font-semibold ${valueClass ?? "text-orange-300"}`}
      >
        {value}
      </div>
    </div>
  );
}

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
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs transition ${
        active
          ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40"
          : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
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
