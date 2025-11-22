// src/features/remove/RemoveLiquidityCard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { UNI_V3_ADDRESSES } from "@/lib/addresses";
import { useTokens } from "@/state/useTokens";

const nfpmAbi = [
  // balanceOf(owner)
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  // tokenOfOwnerByIndex(owner, index)
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // positions(tokenId)
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
  // decreaseLiquidity(params)
  {
    type: "function",
    name: "decreaseLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "liquidity", type: "uint128" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  // collect(params)
  {
    type: "function",
    name: "collect",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "amount0Max", type: "uint128" },
          { name: "amount1Max", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

type RawPosition = readonly [
  bigint, // nonce
  Address, // operator
  Address, // token0
  Address, // token1
  number, // fee
  number, // tickLower
  number, // tickUpper
  bigint, // liquidity
  bigint, // feeGrowthInside0LastX128
  bigint, // feeGrowthInside1LastX128
  bigint, // tokensOwed0
  bigint // tokensOwed1
];

type PositionRow = {
  id: bigint;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
};

export default function RemoveLiquidityCard() {
  const { address } = useAccount();
  const client = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { byAddr } = useTokens();

  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [txPendingFor, setTxPendingFor] = useState<string | null>(null);
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [txErr, setTxErr] = useState<string | null>(null);

  // Fetch all positions for the connected wallet
  useEffect(() => {
    let active = true;
    async function run() {
      setErr(null);
      setRows([]);
      if (!client || !address) return;
      setLoading(true);
      try {
        const nfpm = UNI_V3_ADDRESSES.positionManager as Address;
        const bal = (await client.readContract({
          address: nfpm,
          abi: nfpmAbi,
          functionName: "balanceOf",
          args: [address as Address],
        })) as bigint;

        const n = Number(bal);
        if (n === 0) {
          if (active) setRows([]);
          return;
        }
        // Safety cap
        const maxPositions = Math.min(n, 100);

        const ids = await Promise.all(
          [...Array(maxPositions)].map((_, i) =>
            client.readContract({
              address: nfpm,
              abi: nfpmAbi,
              functionName: "tokenOfOwnerByIndex",
              args: [address as Address, BigInt(i)],
            })
          )
        );

        const pos = await Promise.all(
          ids.map(
            (id) =>
              client.readContract({
                address: nfpm,
                abi: nfpmAbi,
                functionName: "positions",
                args: [id as bigint],
              }) as Promise<RawPosition>
          )
        );

        if (!active) return;
        const rowsMapped: PositionRow[] = pos.map((p, i) => ({
          id: ids[i] as bigint,
          token0: p[2] as Address,
          token1: p[3] as Address,
          fee: Number(p[4]),
          tickLower: Number(p[5]),
          tickUpper: Number(p[6]),
          liquidity: p[7] as bigint,
          tokensOwed0: p[10] as bigint,
          tokensOwed1: p[11] as bigint,
        }));

        setRows(rowsMapped);
      } catch (e: any) {
        if (active)
          setErr(e?.shortMessage || e?.message || "Failed to load positions");
      } finally {
        if (active) setLoading(false);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [client, address]);

  const hasPositions = rows.length > 0;

  async function handleCollect(id: bigint) {
    setTxErr(null);
    setTxMsg(null);
    if (!walletClient || !address) {
      setTxErr("Connect wallet first");
      return;
    }
    try {
      setTxPendingFor(id.toString());
      const nfpm = UNI_V3_ADDRESSES.positionManager as Address;
      const hash = await walletClient.writeContract({
        address: nfpm,
        abi: nfpmAbi,
        functionName: "collect",
        args: [
          {
            tokenId: id,
            recipient: address as Address,
            amount0Max: 2n ** 128n - 1n,
            amount1Max: 2n ** 128n - 1n,
          },
        ],
      });
      setTxMsg(`Collect tx sent: ${String(hash)}`);
    } catch (e: any) {
      setTxErr(e?.shortMessage || e?.message || "Collect failed");
    } finally {
      setTxPendingFor(null);
    }
  }

  async function handleRemove(id: bigint, pct: number) {
    setTxErr(null);
    setTxMsg(null);
    if (!walletClient || !address || !client) {
      setTxErr("Connect wallet first");
      return;
    }
    const row = rows.find((r) => r.id === id);
    if (!row) {
      setTxErr("Position not found in local state");
      return;
    }
    if (row.liquidity === 0n) {
      setTxErr("Position has zero liquidity");
      return;
    }

    const liqToRemove = (row.liquidity * BigInt(pct)) / 100n;
    if (liqToRemove === 0n) {
      setTxErr(`Liquidity too small to remove ${pct}%`);
      return;
    }

    try {
      setTxPendingFor(id.toString());
      const nfpm = UNI_V3_ADDRESSES.positionManager as Address;
      const deadline = BigInt(
        Math.floor(Date.now() / 1000) +
          Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20) * 60
      );

      // 1) decreaseLiquidity
      await walletClient.writeContract({
        address: nfpm,
        abi: nfpmAbi,
        functionName: "decreaseLiquidity",
        args: [
          {
            tokenId: id,
            liquidity: liqToRemove,
            amount0Min: 0n, // v1: no slippage protection
            amount1Min: 0n,
            deadline,
          },
        ],
      });

      // 2) collect
      const hash = await walletClient.writeContract({
        address: nfpm,
        abi: nfpmAbi,
        functionName: "collect",
        args: [
          {
            tokenId: id,
            recipient: address as Address,
            amount0Max: 2n ** 128n - 1n,
            amount1Max: 2n ** 128n - 1n,
          },
        ],
      });

      setTxMsg(
        `Removed ${pct}% and collected from position #${id.toString()} – tx: ${String(
          hash
        )}`
      );

      // Refresh that one position’s view (lightweight)
      try {
        const fresh = (await client.readContract({
          address: UNI_V3_ADDRESSES.positionManager as Address,
          abi: nfpmAbi,
          functionName: "positions",
          args: [id],
        })) as RawPosition;

        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  liquidity: fresh[7] as bigint,
                  tokensOwed0: fresh[10] as bigint,
                  tokensOwed1: fresh[11] as bigint,
                }
              : r
          )
        );
      } catch {
        // best-effort; ignore
      }
    } catch (e: any) {
      setTxErr(e?.shortMessage || e?.message || "Remove liquidity failed");
    } finally {
      setTxPendingFor(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">Your Positions</div>
        <div className="text-xs opacity-70">Manage &amp; remove liquidity</div>
      </div>

      {loading && <div className="text-sm opacity-80">Loading positions…</div>}
      {!loading && !hasPositions && (
        <div className="text-sm opacity-70">
          No v3 positions found for this wallet.
        </div>
      )}
      {err && <div className="text-xs text-red-400">{err}</div>}
      {txErr && <div className="text-xs text-red-400">{txErr}</div>}
      {txMsg && (
        <div className="text-xs text-emerald-400 break-all">{txMsg}</div>
      )}

      {hasPositions && (
        <div className="overflow-x-auto text-sm border border-neutral-800 rounded-xl">
          <table className="w-full">
            <thead className="text-left text-xs uppercase opacity-60 bg-neutral-950/60">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Pair</th>
                <th className="px-3 py-2">Fee</th>
                <th className="px-3 py-2">Ticks</th>
                <th className="px-3 py-2">Liquidity</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t0 = byAddr.get(r.token0.toLowerCase());
                const t1 = byAddr.get(r.token1.toLowerCase());
                const idStr = r.id.toString();
                const isExpanded = expandedId === idStr;
                const pending = txPendingFor === idStr;

                return (
                  <tr
                    key={idStr}
                    className="border-t border-neutral-800 align-top"
                  >
                    <td className="px-3 py-2 font-mono text-xs">#{idStr}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {t0?.logoURI && (
                          <img
                            src={t0.logoURI}
                            alt={t0.symbol}
                            className="w-4 h-4 rounded-full"
                          />
                        )}
                        <span>{t0?.symbol ?? r.token0.slice(0, 6)}</span>
                        <span className="opacity-50">/</span>
                        {t1?.logoURI && (
                          <img
                            src={t1.logoURI}
                            alt={t1.symbol}
                            className="w-4 h-4 rounded-full"
                          />
                        )}
                        <span>{t1?.symbol ?? r.token1.slice(0, 6)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{(r.fee / 10000).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-xs">
                      {r.tickLower} → {r.tickUpper}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">
                      {r.liquidity.toString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="text-xs px-3 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700"
                        onClick={() =>
                          setExpandedId((prev) =>
                            prev === idStr ? null : idStr
                          )
                        }
                      >
                        {isExpanded ? "Hide" : "Manage"}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 text-xs space-y-2">
                          <div className="opacity-70 mb-1">Quick remove</div>
                          <div className="flex flex-wrap gap-2">
                            {[25, 50, 100].map((pct) => (
                              <button
                                key={pct}
                                className="px-3 py-1 rounded-full bg-brand text-white hover:opacity-90 disabled:opacity-50"
                                disabled={pending || r.liquidity === 0n}
                                onClick={() => handleRemove(r.id, pct)}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                          <div className="opacity-70 mt-2 mb-1">Fees</div>
                          <div className="flex justify-between">
                            <span>
                              Owed0:{" "}
                              <span className="font-mono">
                                {r.tokensOwed0.toString()}
                              </span>
                            </span>
                            <span>
                              Owed1:{" "}
                              <span className="font-mono">
                                {r.tokensOwed1.toString()}
                              </span>
                            </span>
                          </div>
                          <button
                            className="mt-2 px-3 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
                            disabled={pending}
                            onClick={() => handleCollect(r.id)}
                          >
                            Collect fees only
                          </button>
                          {pending && (
                            <div className="mt-1 text-[11px] opacity-70">
                              Submitting transaction…
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
