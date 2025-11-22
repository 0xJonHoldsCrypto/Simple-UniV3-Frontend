// src/hooks/useAutoFeeTier.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { getPoolAddress } from "@/lib/univ3/pools";
import { quoteExactInSingle } from "@/lib/univ3/quotes";

export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

type Result = { fee: FeeTier | null; pool?: Address | null };

export function useAutoFeeTier({
  tokenIn,
  tokenOut,
  amountInHuman,
  decimalsIn,
  preferBestQuote = true, // if false, pick lowest fee with liquidity
}: {
  tokenIn?: Address;
  tokenOut?: Address;
  amountInHuman: string;
  decimalsIn: number;
  preferBestQuote?: boolean;
}): { fee: FeeTier | null; loading: boolean; error: string | null } {
  const client = usePublicClient();
  const [fee, setFee] = useState<FeeTier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only run when we have enough info
  const ready = useMemo(() => {
    if (!client || !tokenIn || !tokenOut) return false;
    const n = Number(amountInHuman || "0");
    return Number.isFinite(n) && n > 0;
  }, [client, tokenIn, tokenOut, amountInHuman]);

  useEffect(() => {
    let active = true;
    async function run() {
      setError(null);
      setFee(null);

      if (!ready) return;
      setLoading(true);
      try {
        // 1) Find which fee tiers have a pool
        const pools: { fee: FeeTier; pool: Address }[] = [];
        for (const f of FEE_TIERS) {
          const p = await getPoolAddress(client!, tokenIn!, tokenOut!, f);
          if (p && p !== "0x0000000000000000000000000000000000000000") {
            pools.push({ fee: f, pool: p as Address });
          }
        }

        if (!pools.length) throw new Error("No pools for this pair");

        // 2) If preferBestQuote, call quoter for each and pick the max amountOut
        if (preferBestQuote) {
          const quotes = await Promise.allSettled(
            pools.map(({ fee }) =>
              quoteExactInSingle(client!, {
                tokenIn: tokenIn!,
                tokenOut: tokenOut!,
                fee,
                amountInHuman,
                decimalsIn,
              }).then((out) => ({ fee, out }))
            )
          );

          const successes = quotes
            .filter(
              (r): r is PromiseFulfilledResult<{ fee: FeeTier; out: bigint }> =>
                r.status === "fulfilled"
            )
            .map((r) => r.value);

          if (successes.length) {
            successes.sort((a, b) =>
              a.out > b.out ? -1 : a.out < b.out ? 1 : 0
            );
            if (active) setFee(successes[0].fee);
            return;
          }
          // fallthrough to lowest-fee-with-liquidity if all quotes failed
        }

        // 3) Fallback: pick the lowest fee tier that exists
        const lowest = pools.sort((a, b) => a.fee - b.fee)[0];
        if (active) setFee(lowest.fee);
      } catch (e: any) {
        if (active) setError(e?.message || "Auto fee selection failed");
      } finally {
        if (active) setLoading(false);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [
    ready,
    client,
    tokenIn,
    tokenOut,
    amountInHuman,
    decimalsIn,
    preferBestQuote,
  ]);

  return { fee, loading, error };
}
