export const hemi = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 0),
  name: 'Hemi',
  // Hemi uses ETH as the native gas token
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: process.env.NEXT_PUBLIC_EXPLORER_URL ?? '' },
  },
} as const