export const hemi = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 0),
  name: "Hemi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ""] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ""] },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "",
    },
  },
  contracts: {
    multicall3: {
      address: (process.env.NEXT_PUBLIC_MULTICALL3 ??
        process.env.NEXT_PUBLIC_MULTICALL2) as `0x${string}`,
      // if you don’t know the deploy block, 0 is fine
      blockCreated: 0,
    },
  },
} as const;
