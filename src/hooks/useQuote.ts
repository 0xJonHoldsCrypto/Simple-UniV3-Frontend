// src/hooks/useQuote.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { useTokens } from "@/state/useTokens";
import { quoteExactInSingle } from "@/lib/univ3/quotes";

export function useQuote({
  tokenIn,
  tokenOut,
  amountInHuman,
  fee,
  slippageBps,
  pathTokens,
  pathFees,
}: {
  tokenIn?: Address;
  tokenOut?: Address;
  amountInHuman: string;
  fee: number;
  slippageBps: number;
  pathTokens?: Address[];
  pathFees?: number[];
}) {
  const client = usePublicClient();
  const { byAddr } = useTokens();

  const [amountOut, setAmountOut] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefer decimals from token list; fall back to 18
  const decIn = useMemo(() => {
    return tokenIn ? byAddr.get(tokenIn.toLowerCase())?.decimals ?? 18 : 18;
  }, [byAddr, tokenIn]);

  useEffect(() => {
    let active = true;

    async function run() {
      setError(null);
      setAmountOut(null);

      try {
        if (!client) throw new Error("No public client");
        if (!tokenIn || !tokenOut) return; // UI not ready yet
        if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
          throw new Error("Pick two different tokens");
        }

        const amt = Number(amountInHuman || "0");
        if (!Number.isFinite(amt) || amt <= 0) {
          return; // wait until user enters a positive amount
        }

        setLoading(true);

        let finalOut: bigint;

        // If a multi-hop path is provided and valid, quote hop-by-hop
        if (
          pathTokens &&
          pathFees &&
          pathTokens.length >= 2 &&
          pathFees.length === pathTokens.length - 1
        ) {
          let currentAmountHuman = amountInHuman;

          for (let i = 0; i < pathTokens.length - 1; i++) {
            const hopIn = pathTokens[i]!;
            const hopOut = pathTokens[i + 1]!;
            const hopFee = pathFees[i]!;

            const hopDecIn = byAddr.get(hopIn.toLowerCase())?.decimals ?? 18;
            const hopDecOut = byAddr.get(hopOut.toLowerCase())?.decimals ?? 18;

            const hopOutAmount = await quoteExactInSingle(client, {
              tokenIn: hopIn,
              tokenOut: hopOut,
              fee: hopFee,
              amountInHuman: currentAmountHuman,
              decimalsIn: hopDecIn,
            });

            // Prepare input for next hop as human-readable string
            currentAmountHuman = formatUnits(hopOutAmount, hopDecOut);
            finalOut = hopOutAmount;
          }

          if (!active) return;
          setAmountOut(finalOut!);
        } else {
          // Fallback: single pool quote
          const out = await quoteExactInSingle(client, {
            tokenIn,
            tokenOut,
            fee,
            amountInHuman,
            decimalsIn: decIn,
          });

          if (!active) return;
          setAmountOut(out);
        }
      } catch (e: any) {
        if (!active) return;
        const msg = e?.shortMessage || e?.message || "Quote failed";
        console.warn("[useQuote]", msg, e);
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    run();
    return () => {
      active = false;
    };
  }, [
    client,
    tokenIn,
    tokenOut,
    amountInHuman,
    fee,
    decIn,
    pathTokens,
    pathFees,
  ]);

  const minOut = useMemo(() => {
    if (!amountOut) return 0n;
    return amountOut - (amountOut * BigInt(slippageBps)) / 10_000n;
  }, [amountOut, slippageBps]);

  return { amountOut, minOut, decIn, loading, error };
}
