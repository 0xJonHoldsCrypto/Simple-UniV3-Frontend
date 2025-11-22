// src/features/positions/PositionsTable.tsx
"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { UNI_V3_ADDRESSES } from "@/lib/addresses";
import { useTokens } from "@/state/useTokens";

const nfpmAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
  {
    // collect(address recipient, uint256 tokenId, uint128 amount0Max, uint128 amount1Max)
    type: "function",
    name: "collect",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount0Max", type: "uint128" },
      { name: "amount1Max", type: "uint128" },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

type PositionRow = {
  tokenId: string;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
};

export default function PositionsTable() {
  const { address } = useAccount();
  const client = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { byAddr } = useTokens();

  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [collectingId, setCollectingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function run() {
      setError(null);
      setRows([]);
      if (!client || !address) return;

      setLoading(true);
      try {
        const nfpm = (UNI_V3_ADDRESSES.positionManager ??
          (UNI_V3_ADDRESSES as any).nfpm) as Address;

        const balance = (await client.readContract({
          address: nfpm,
          abi: nfpmAbi,
          functionName: "balanceOf",
          args: [address as Address],
        })) as bigint;

        const n = Number(balance);
        if (!active) return;

        if (n === 0) {
          setRows([]);
          return;
        }

        const indices = Array.from({ length: n }, (_, i) => BigInt(i));

        const tokenIds = await Promise.all(
          indices.map(
            (i) =>
              client.readContract({
                address: nfpm,
                abi: nfpmAbi,
                functionName: "tokenOfOwnerByIndex",
                args: [address as Address, i],
              }) as Promise<bigint>
          )
        );

        if (!active) return;

        const positions = await Promise.all(
          tokenIds.map(
            (id) =>
              client.readContract({
                address: nfpm,
                abi: nfpmAbi,
                functionName: "positions",
                args: [id],
              }) as Promise<any>
          )
        );

        if (!active) return;

        const mapped: PositionRow[] = positions.map((p, i) => ({
          tokenId: tokenIds[i].toString(),
          token0: p[2] as Address,
          token1: p[3] as Address,
          fee: Number(p[4]),
          tickLower: Number(p[5]),
          tickUpper: Number(p[6]),
          liquidity: (p[7] as bigint).toString(),
          tokensOwed0: (p[10] as bigint).toString(),
          tokensOwed1: (p[11] as bigint).toString(),
        }));

        setRows(mapped);
      } catch (e: any) {
        console.error("positions error", e);
        if (!active) return;
        setError(e?.shortMessage || e?.message || "Failed to load positions");
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      active = false;
    };
  }, [client, address, reload]);

  async function onCollect(row: PositionRow) {
    if (!walletClient || !address) return;
    try {
      setCollectingId(row.tokenId);
      const nfpm = (UNI_V3_ADDRESSES.positionManager ??
        (UNI_V3_ADDRESSES as any).nfpm) as Address;

      const max = 2n ** 128n - 1n; // uint128 max

      await walletClient.writeContract({
        address: nfpm,
        abi: nfpmAbi,
        functionName: "collect",
        args: [address as Address, BigInt(row.tokenId), max, max],
      });

      // re-fetch positions to update owed amounts
      setReload((x) => x + 1);
    } catch (e: any) {
      console.error("collect error", e);
      // we can optionally set a UI error if you want
    } finally {
      setCollectingId(null);
    }
  }

  if (!address) {
    return (
      <div className="text-sm opacity-80">
        Connect your wallet to view your liquidity positions.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm opacity-80">Loading positions…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-400">{error}</div>;
  }

  if (!rows.length) {
    return (
      <div className="text-sm opacity-80">
        No Uniswap v3 positions found for this wallet on Hemi.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto text-sm">
      <table className="w-full border-collapse">
        <thead className="text-left opacity-70 border-b border-neutral-800">
          <tr>
            <th className="py-2 pr-2">ID</th>
            <th className="py-2 pr-2">Pair</th>
            <th className="py-2 pr-2">Fee</th>
            <th className="py-2 pr-2">Tick Range</th>
            <th className="py-2 pr-2">Liquidity</th>
            <th className="py-2 pr-2">Unclaimed</th>
            <th className="py-2 pr-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t0 = byAddr.get(r.token0.toLowerCase());
            const t1 = byAddr.get(r.token1.toLowerCase());
            const isCollecting = collectingId === r.tokenId;

            return (
              <tr key={r.tokenId} className="border-b border-neutral-900">
                <td className="py-2 pr-2 font-mono text-xs">#{r.tokenId}</td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    {t0?.logoURI && (
                      <img
                        src={t0.logoURI}
                        alt={t0.symbol}
                        className="w-4 h-4 rounded-full"
                      />
                    )}
                    <span>{t0?.symbol ?? r.token0.slice(0, 6) + "…"}</span>
                    <span className="opacity-60">/</span>
                    {t1?.logoURI && (
                      <img
                        src={t1.logoURI}
                        alt={t1.symbol}
                        className="w-4 h-4 rounded-full"
                      />
                    )}
                    <span>{t1?.symbol ?? r.token1.slice(0, 6) + "…"}</span>
                  </div>
                </td>
                <td className="py-2 pr-2">{(r.fee / 10000).toFixed(2)}%</td>
                <td className="py-2 pr-2">
                  {r.tickLower} → {r.tickUpper}
                </td>
                <td className="py-2 pr-2">{r.liquidity}</td>
                <td className="py-2 pr-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="opacity-80">owed0: {r.tokensOwed0}</span>
                    <span className="opacity-80">owed1: {r.tokensOwed1}</span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-right">
                  <button
                    className="px-3 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
                    onClick={() => onCollect(r)}
                    disabled={isCollecting}
                  >
                    {isCollecting ? "Collecting…" : "Collect fees"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
