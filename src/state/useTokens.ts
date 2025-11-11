'use client'
import { create } from 'zustand'
import { tokensForChain, Token } from '@/lib/tokens'

type TokenState = {
  tokens: Token[]
  byAddr: Map<string, Token>
  setChain: (chainId: number) => void
}

export const useTokens = create<TokenState>((set) => ({
  tokens: [],
  byAddr: new Map(),
  setChain: (chainId) => {
    const toks = tokensForChain(chainId)
    const by = new Map<string, Token>()
    toks.forEach(t => by.set(t.address.toLowerCase(), t))
    set({ tokens: toks, byAddr: by })
  },
}))