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
    if (!switchChain) return
    if (chainId !== hemi.id) {
      try {
        switchChain({ chainId: hemi.id })
      } catch (err) {
        console.warn('User rejected or failed chain switch', err)
      }
    }
  }, [chainId, switchChain])

  const isHemi = chainId === hemi.id

  return (
    <button
      onClick={() => {
        if (!switchChain) return
        try {
          switchChain({ chainId: hemi.id })
        } catch (err) {
          console.warn('Manual chain switch failed', err)
        }
      }}
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