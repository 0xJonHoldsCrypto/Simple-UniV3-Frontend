'use client'
import Image from 'next/image'
import { useEffect } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'
import { hemi } from '@/lib/chains/hemi'

export default function NetworkSwitcher() {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  // Auto-switch to Hemi on load
  useEffect(() => {
    if (!chainId) return
    if (chainId !== hemi.id) {
      switchChain({ chainId: hemi.id }).catch(() => {
        console.warn('User rejected chain switch')
      })
    }
  }, [chainId, switchChain])

  const isHemi = chainId === hemi.id

  return (
    <button
      onClick={() => switchChain({ chainId: hemi.id })}
      className={`flex items-center gap-2 px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-sm transition ${
        isHemi ? 'text-orange-400' : 'text-neutral-300'
      }`}
    >
      <Image
        src="/hemi-logo.png"     // ⬅️ Place logo in /public/hemi-logo.png
        alt="Hemi"
        width={16}
        height={16}
      />
      {isHemi ? 'Hemi ✓' : 'Switch to Hemi'}
    </button>
  )
}