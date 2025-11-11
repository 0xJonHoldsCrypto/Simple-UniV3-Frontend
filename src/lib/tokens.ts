import type { Address } from 'viem'
export type Token = { address: Address; symbol: string; name: string; decimals: number }
export const TOKENS: Token[] = [
  // TODO: populate Hemi token list
  // { address: '0x...', symbol: 'WHEMI', name: 'Wrapped HEMI', decimals: 18 },
]
export const byAddress: Record<string, Token> = Object.fromEntries(
  TOKENS.map((t) => [t.address.toLowerCase(), t])
)