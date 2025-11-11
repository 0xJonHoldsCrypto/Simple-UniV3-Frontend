'use client'
import { useEffect } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'
import { hemi } from '@/lib/chains/hemi'

export default function NetworkGuard() {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  useEffect(() => {
    if (chainId && hemi.id && chainId !== hemi.id) {
      try { switchChain({ chainId: hemi.id }) } catch {}
    }
  }, [chainId, switchChain])
  return null
}