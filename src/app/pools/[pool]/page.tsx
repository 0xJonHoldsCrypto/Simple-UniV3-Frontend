

'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import { usePublicClient } from 'wagmi'

// Minimal ABIs for on-chain Uniswap V3 pool stats
const poolAbi = [
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'fee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint24' }],
  },
  {
    type: 'function',
    name: 'tickSpacing',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'int24' }],
  },
  {
    type: 'function',
    name: 'liquidity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
] as const

const erc20Abi = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

function feeLabel(fee: number) {
  return `${(fee / 1e4).toFixed(2)}%`
}

// price of token1 per token0 (adjusted for decimals)
function priceFromSqrtPriceX96(sqrtPriceX96: bigint, dec0: number, dec1: number) {
  const Q192 = 2n ** 192n
  const num = sqrtPriceX96 * sqrtPriceX96
  // ratio is token1/token0 in raw units
  const ratioX18 = (num * 10n ** 18n) / Q192
  const ratio = Number(ratioX18) / 1e18
  return ratio * Math.pow(10, dec0 - dec1)
}

export default function PoolStatsPage({ params }: { params?: { pool?: string } }) {
  const publicClient = usePublicClient()

  // In App Router this component should live at /app/pools/[pool]/page.tsx
  // and Next will pass params.pool. If you keep this file in /api, move it.
  const poolAddress = (params?.pool ?? '') as Address

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [token0, setToken0] = useState<Address | null>(null)
  const [token1, setToken1] = useState<Address | null>(null)
  const [fee, setFee] = useState<number | null>(null)
  const [tickSpacing, setTickSpacing] = useState<number | null>(null)
  const [liquidity, setLiquidity] = useState<bigint | null>(null)
  const [sqrtPriceX96, setSqrtPriceX96] = useState<bigint | null>(null)
  const [tick, setTick] = useState<number | null>(null)

  const [sym0, setSym0] = useState<string | null>(null)
  const [sym1, setSym1] = useState<string | null>(null)
  const [dec0, setDec0] = useState<number | null>(null)
  const [dec1, setDec1] = useState<number | null>(null)

  const [bal0, setBal0] = useState<bigint | null>(null)
  const [bal1, setBal1] = useState<bigint | null>(null)

  useEffect(() => {
    let active = true
    async function run() {
      setError(null)
      if (!publicClient || !poolAddress || poolAddress.length !== 42) return
      setLoading(true)
      try {
        const [t0, t1, f, ts, L, slot0] = await Promise.all([
          publicClient.readContract({ address: poolAddress, abi: poolAbi, functionName: 'token0' }) as Promise<Address>,
          publicClient.readContract({ address: poolAddress, abi: poolAbi, functionName: 'token1' }) as Promise<Address>,
          publicClient.readContract({ address: poolAddress, abi: poolAbi, functionName: 'fee' }) as Promise<number>,
          publicClient.readContract({ address: poolAddress, abi: poolAbi, functionName: 'tickSpacing' }) as Promise<number>,
          publicClient.readContract({ address: poolAddress, abi: poolAbi, functionName: 'liquidity' }) as Promise<bigint>,
          publicClient.readContract({ address: poolAddress, abi: poolAbi, functionName: 'slot0' }) as Promise<readonly [bigint, number, number, number, number, number, boolean]>,
        ])
        if (!active) return
        setToken0(t0)
        setToken1(t1)
        setFee(Number(f))
        setTickSpacing(Number(ts))
        setLiquidity(L)
        setSqrtPriceX96(slot0[0])
        setTick(Number(slot0[1]))

        const [s0, s1, d0, d1, b0, b1] = await Promise.all([
          publicClient.readContract({ address: t0, abi: erc20Abi, functionName: 'symbol' }) as Promise<string>,
          publicClient.readContract({ address: t1, abi: erc20Abi, functionName: 'symbol' }) as Promise<string>,
          publicClient.readContract({ address: t0, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
          publicClient.readContract({ address: t1, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
          publicClient.readContract({ address: t0, abi: erc20Abi, functionName: 'balanceOf', args: [poolAddress] }) as Promise<bigint>,
          publicClient.readContract({ address: t1, abi: erc20Abi, functionName: 'balanceOf', args: [poolAddress] }) as Promise<bigint>,
        ])
        if (!active) return
        setSym0(s0)
        setSym1(s1)
        setDec0(Number(d0))
        setDec1(Number(d1))
        setBal0(b0)
        setBal1(b1)
      } catch (e: any) {
        console.error('[PoolStats] load failed', e)
        if (active) setError(e?.shortMessage ?? e?.message ?? 'Failed to load pool')
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [publicClient, poolAddress])

  const price01 = useMemo(() => {
    if (sqrtPriceX96 == null || dec0 == null || dec1 == null) return null
    const p = priceFromSqrtPriceX96(sqrtPriceX96, dec0, dec1)
    return Number.isFinite(p) ? p : null
  }, [sqrtPriceX96, dec0, dec1])

  const price10 = useMemo(() => (price01 && price01 !== 0 ? 1 / price01 : null), [price01])

  if (!poolAddress) {
    return (
      <div className="max-w-2xl mx-auto rounded-2xl p-4 bg-neutral-900 shadow">
        <div className="text-sm opacity-80">No pool address provided.</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Pool Stats</div>
          <div className="text-xs opacity-70 font-mono break-all">{poolAddress}</div>
        </div>
        <div className="text-right text-xs opacity-80">
          {fee != null ? `Fee: ${feeLabel(fee)}` : ''}
        </div>
      </div>

      {loading && <div className="text-sm opacity-80">Loading on-chain data…</div>}
      {error && <div className="text-sm text-red-400">{error}</div>}

      {!loading && !error && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-neutral-900/70 rounded-xl p-3">
              <div className="text-xs opacity-70">Token 0</div>
              <div className="font-medium">{sym0 ?? token0}</div>
              <div className="text-xs opacity-60 font-mono break-all">{token0}</div>
            </div>
            <div className="bg-neutral-900/70 rounded-xl p-3">
              <div className="text-xs opacity-70">Token 1</div>
              <div className="font-medium">{sym1 ?? token1}</div>
              <div className="text-xs opacity-60 font-mono break-all">{token1}</div>
            </div>
          </div>

          <div className="bg-neutral-900/70 rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="opacity-70">Tick</span><span>{tick ?? '—'}</span></div>
            <div className="flex justify-between"><span className="opacity-70">Tick spacing</span><span>{tickSpacing ?? '—'}</span></div>
            <div className="flex justify-between"><span className="opacity-70">Liquidity</span><span className="font-mono">{liquidity?.toString() ?? '—'}</span></div>
          </div>

          <div className="bg-neutral-900/70 rounded-xl p-3 text-sm space-y-1">
            <div className="text-xs opacity-70 mb-1">Current price</div>
            <div className="font-medium">
              {price01 != null && sym0 && sym1 ? `${price01.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sym1}/${sym0}` : '—'}
            </div>
            <div className="text-xs opacity-70">
              {price10 != null && sym0 && sym1 ? `${price10.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sym0}/${sym1}` : ''}
            </div>
          </div>

          <div className="bg-neutral-900/70 rounded-xl p-3 text-sm space-y-1">
            <div className="text-xs opacity-70 mb-1">Pool balances (TVL-ish)</div>
            <div className="flex justify-between">
              <span>{sym0 ?? 'token0'}</span>
              <span>{bal0 != null && dec0 != null ? formatUnits(bal0, dec0) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>{sym1 ?? 'token1'}</span>
              <span>{bal1 != null && dec1 != null ? formatUnits(bal1, dec1) : '—'}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <a
              className="btn flex-1 text-center"
              href={`/add?tokenA=${token0}&tokenB=${token1}&fee=${fee ?? ''}`}
            >
              Add Liquidity
            </a>
            <a
              className="btn flex-1 text-center"
              href={`/swap?tokenIn=${token0}&tokenOut=${token1}`}
            >
              Swap
            </a>
          </div>
        </div>
      )}
    </div>
  )
}