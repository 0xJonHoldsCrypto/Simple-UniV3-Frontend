// src/components/TokenInput.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useTokens } from "@/state/useTokens";

type Props = {
  label: string;
  value?: Address;
  onChange: (value?: Address) => void;

  // Optional filters for token selector (used e.g. on Swap to hide canonical tokens)
  excludeAddrs?: Address[];
  excludeSymbols?: string[]; // case-insensitive
};

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "o", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export default function TokenInput({
  label,
  value,
  onChange,
  excludeAddrs,
  excludeSymbols,
}: Props) {
  const { tokens, byAddr } = useTokens();
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [loadingBalances, setLoadingBalances] = useState(false);

  const selected = value ? byAddr.get(value.toLowerCase()) : undefined;

  const tokensForModal = useMemo(() => {
    const exclAddrs = new Set((excludeAddrs ?? []).map((a) => a.toLowerCase()));
    const exclSyms = new Set(
      (excludeSymbols ?? []).map((s) => s.toLowerCase())
    );

    if (!exclAddrs.size && !exclSyms.size) return tokens;

    return tokens.filter((t) => {
      const addr = t.address.toLowerCase();
      const sym = (t.symbol ?? "").toLowerCase();
      return !exclAddrs.has(addr) && !exclSyms.has(sym);
    });
  }, [tokens, excludeAddrs, excludeSymbols]);

  // ---- load balances when modal opens ----
  useEffect(() => {
    let active = true;
    async function run() {
      if (!open || !address || !publicClient || !tokensForModal.length) return;
      setLoadingBalances(true);
      try {
        const entries: [string, bigint][] = await Promise.all(
          tokensForModal.map(async (t) => {
            const addr = t.address as Address;
            try {
              const bal = (await publicClient.readContract({
                address: addr,
                abi: erc20BalanceAbi,
                functionName: "balanceOf",
                args: [address as Address],
              })) as bigint;
              return [t.address.toLowerCase(), bal];
            } catch {
              return [t.address.toLowerCase(), 0n];
            }
          })
        );
        if (active) setBalances(new Map(entries));
      } finally {
        if (active) setLoadingBalances(false);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [open, address, publicClient, tokensForModal]);

  // ---- filter + sort tokens for the list ----
  const filteredTokens = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tokensForModal;

    if (q) {
      list = list.filter((t) => {
        const sym = t.symbol?.toLowerCase() ?? "";
        const name = t.name?.toLowerCase() ?? "";
        const addr = t.address.toLowerCase();
        return sym.includes(q) || name.includes(q) || addr.startsWith(q);
      });
    }

    // sort by balance desc, then symbol asc
    const withSort = [...list];
    withSort.sort((a, b) => {
      const ba = balances.get(a.address.toLowerCase()) ?? 0n;
      const bb = balances.get(b.address.toLowerCase()) ?? 0n;
      if (ba === bb) {
        return (a.symbol || "").localeCompare(b.symbol || "");
      }
      return bb > ba ? 1 : -1;
    });
    return withSort;
  }, [tokensForModal, search, balances]);
  function handleSelect(addr: string) {
    onChange(addr as Address);
    setOpen(false);
  }

  function displayBalance(addr: string, decimals: number) {
    const bal = balances.get(addr.toLowerCase());
    if (bal == null) return "";
    try {
      const num = Number(formatUnits(bal, decimals));
      if (num === 0) return "0";
      if (num < 0.0001) return "<0.0001";
      return num.toFixed(4).replace(/\.?0+$/, "");
    } catch {
      return "";
    }
  }

  return (
    <>
      {/* main input */}
      <div className="space-y-1 cursor-pointer" onClick={() => setOpen(true)}>
        <div className="text-xs opacity-70">{label}</div>
        <div className="w-full bg-neutral-800 p-3 rounded flex items-center justify-between">
          {selected ? (
            <>
              <div className="flex items-center gap-2">
                {selected.logoURI && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.logoURI}
                    alt={selected.symbol}
                    className="w-6 h-6 rounded-full"
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{selected.symbol}</span>
                  <span className="text-xs opacity-70">{selected.name}</span>
                </div>
              </div>
              <span className="text-xs opacity-60">
                {selected.address.slice(0, 6)}…{selected.address.slice(-4)}
              </span>
            </>
          ) : (
            <span className="opacity-60 text-sm">Select a token</span>
          )}
        </div>
      </div>

      {/* modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-2xl bg-neutral-900 p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Select a token</div>
              <button
                onClick={() => setOpen(false)}
                className="text-sm opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>

            <input
              className="w-full mb-3 bg-neutral-800 p-2 rounded text-sm"
              placeholder="Search name or paste address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {loadingBalances && (
              <div className="text-xs opacity-60 mb-2">Loading balances…</div>
            )}

            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredTokens.map((t) => {
                const balDisplay = displayBalance(t.address, t.decimals ?? 18);
                const hasBalance = balDisplay !== "" && balDisplay !== "0";
                return (
                  <button
                    key={t.address}
                    type="button"
                    onClick={() => handleSelect(t.address)}
                    className="w-full flex items-center justify-between px-2 py-2 rounded hover:bg-neutral-800 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {t.logoURI && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.logoURI}
                          alt={t.symbol}
                          className="w-6 h-6 rounded-full"
                        />
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{t.symbol}</span>
                        <span className="text-xs opacity-70">{t.name}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      {balDisplay !== "" && (
                        <div
                          className={`text-xs ${
                            hasBalance ? "opacity-100" : "opacity-50"
                          }`}
                        >
                          {balDisplay} {t.symbol}
                        </div>
                      )}
                      <div className="text-[10px] opacity-40 font-mono">
                        {t.address.slice(0, 6)}…{t.address.slice(-4)}
                      </div>
                    </div>
                  </button>
                );
              })}

              {!filteredTokens.length && (
                <div className="text-xs opacity-60 py-4 text-center">
                  No tokens found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
