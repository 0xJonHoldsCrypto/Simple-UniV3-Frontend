'use client'
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain, useChains } from 'wagmi'

const short = (a?: string) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '')

export default function ConnectButton() {
  const { address, isConnected, connector } = useAccount()
  const { connect, connectors, status, error } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const chains = useChains()
  const target = chains?.[0] // our single Hemi chain from wagmi config

  if (!isConnected) {
    const injected = connectors.find(c => c.id === 'injected') // MetaMask etc.
    return (
      <div className="flex items-center gap-2">
        <button
          className="btn"
          onClick={() => injected ? connect({ connector: injected }) : connect({ connector: connectors[0] })}
          disabled={status === 'pending'}
        >
          {status === 'pending' ? 'Connecting…' : 'Connect Wallet'}
        </button>
        {error && <span className="text-xs text-red-400">{String(error.message).slice(0, 80)}</span>}
      </div>
    )
  }

  const wrongNetwork = !!(target && chainId && target.id !== chainId)
  return (
    <div className="flex items-center gap-2">
      {wrongNetwork && (
        <button className="btn" onClick={() => switchChain({ chainId: target!.id })}>
          Switch to {target?.name}
        </button>
      )}
      <button className="btn" onClick={() => disconnect()}>{short(address)} · Disconnect</button>
      {connector?.name && <span className="text-xs opacity-70">{connector.name}</span>}
    </div>
  )
}