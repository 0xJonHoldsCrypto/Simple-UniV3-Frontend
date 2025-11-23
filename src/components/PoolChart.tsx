"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
} from "lightweight-charts";

export function PoolChart({
  ohlcv,
}: {
  ohlcv: Array<[number, number, number, number, number, number]>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [legend, setLegend] = useState<{
    time?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    vol?: number;
  } | null>(null);

  useEffect(() => {
    if (!ref.current || !ohlcv?.length) return;

    ref.current.innerHTML = "";

    const chart: IChartApi = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 360,
      layout: {
        background: { color: "transparent" },
        textColor: "#a3a3a3",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      borderVisible: false,
      wickVisible: true,
      priceLineVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      scaleMargins: { top: 0.8, bottom: 0 },
      lastValueVisible: false,
    });

    const sorted = [...ohlcv]
      .filter((row) => Array.isArray(row) && row.length >= 6)
      .sort((a, b) => a[0] - b[0]);

    const candles: CandlestickData<UTCTimestamp>[] = sorted.map(
      ([ts, o, h, l, c]) => {
        const tSec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
        return {
          time: tSec as UTCTimestamp,
          open: +o,
          high: +h,
          low: +l,
          close: +c,
        };
      }
    );

    let vols: HistogramData<UTCTimestamp>[] = sorted.map(
      ([ts, _o, _h, _l, _c, v], i) => {
        const tSec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
        return {
          time: tSec as UTCTimestamp,
          value: +v,
          color:
            candles[i].close >= candles[i].open
              ? "rgba(16,185,129,0.6)"
              : "rgba(239,68,68,0.6)",
        };
      }
    );

    const cleanCandles = candles
      .filter(
        (c) =>
          c &&
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
      )
      .sort((a, b) => a.time - b.time);

    const dedupCandles: typeof cleanCandles = [];
    for (const c of cleanCandles) {
      const prev = dedupCandles[dedupCandles.length - 1];
      if (!prev || prev.time !== c.time) dedupCandles.push(c);
      else dedupCandles[dedupCandles.length - 1] = c;
    }

    const cleanVols = vols
      .filter((v) => v && Number.isFinite(v.time) && Number.isFinite(v.value))
      .sort((a, b) => a.time - b.time);

    const dedupVols: typeof cleanVols = [];
    for (const v of cleanVols) {
      const prev = dedupVols[dedupVols.length - 1];
      if (!prev || prev.time !== v.time) dedupVols.push(v);
      else dedupVols[dedupVols.length - 1] = v;
    }

    candleSeries.setData(dedupCandles);
    volumeSeries.setData(dedupVols);
    chart.timeScale().fitContent();

    const onMove = (param: any) => {
      if (!param.time || !param.seriesData) {
        setLegend(null);
        return;
      }

      const c = param.seriesData.get(candleSeries) as any;
      const v = param.seriesData.get(volumeSeries) as any;
      if (!c) {
        setLegend(null);
        return;
      }

      setLegend({
        time: (param.time as number) * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        vol: v?.value,
      });
    };

    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => {
      if (!ref.current) return;
      chart.applyOptions({ width: ref.current.clientWidth });
      chart.timeScale().fitContent();
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [ohlcv]);

  return (
    <div className="relative w-full">
      {legend && (
        <div className="absolute left-2 top-2 z-10 text-xs bg-neutral-950/80 rounded px-2 py-1 text-neutral-200">
          <div>{new Date(legend.time!).toLocaleString()}</div>
          <div>
            O {legend.open?.toFixed(4)} H {legend.high?.toFixed(4)} L{" "}
            {legend.low?.toFixed(4)} C {legend.close?.toFixed(4)}
          </div>
          {legend.vol != null && <div>Vol ${legend.vol.toLocaleString()}</div>}
        </div>
      )}
      <div ref={ref} className="w-full" />
    </div>
  );
}