import raw from './tokenlist.json'

export type TokenList = {
  name: string
  timestamp: string
  version: { major: number; minor: number; patch: number }
  tokens: Array<{
    address: `0x${string}`
    chainId: number
    decimals: number
    logoURI?: string
    name: string
    symbol: string
  }>
}

const LIST = raw as TokenList

export function tokensForChain(chainId: number) {
  return LIST.tokens.filter(t => t.chainId === chainId)
}

// quick index helpers
export function mapByAddress(chainId: number) {
  const map = new Map<string, Token>()
  tokensForChain(chainId).forEach(t => map.set(t.address.toLowerCase(), t))
  return map
}

export type Token = ReturnType<typeof tokensForChain>[number]