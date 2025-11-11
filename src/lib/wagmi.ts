// wagmi v2 config for Hemi chain (inline chain + conditional WalletConnect)
import { createConfig, http } from 'wagmi'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
// Inline Hemi chain (ETH native)
export const hemi = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 0),
  name: 'Hemi',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: process.env.NEXT_PUBLIC_EXPLORER_URL ?? '' },
  },
} as const

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID

const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: 'Hemi UniV3' }),
  ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
]

export const config = createConfig({
  chains: [hemi],
  connectors,
  transports: {
    [hemi.id]: http(hemi.rpcUrls.default.http[0] ?? ''),
  },
  multiInjectedProviderDiscovery: true,
})