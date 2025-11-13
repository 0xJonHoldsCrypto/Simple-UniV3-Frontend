// src/features/add/AddLiquidityCard.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { parseUnits, formatUnits } from 'viem'
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi'

import TokenInput from '@/components/TokenInput'
import SlippageControl from '@/components/SlippageControl'
import { useTokens } from '@/state/useTokens'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'
import { getPoolState, getPoolAddress } from '@/lib/univ3/pools'
import { getFullRangeTicks } from '@/lib/univ3/position'

const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

const nfpmAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const

export default function AddLiquidityCard() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { tokens, byAddr } = useTokens()

  // form state
  const [tokenA, setTokenA] = useState<Address | undefined>()
  const [tokenB, setTokenB] = useState<Address | undefined>()
  const [fee, setFee] = useState(3000) // 0.30% default
  const [amountA, setAmountA] = useState('0.1')
  const [amountB, setAmountB] = useState('100')
  const [slippageBps, setSlippageBps] = useState(
    Number(process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 50)
  )

  const [poolAddress, setPoolAddress] = useState<Address | null>(null)
  const [tickLower, setTickLower] = useState<number | null>(null)
  const [tickUpper, setTickUpper] = useState<number | null>(null)
  const [loadingPool, setLoadingPool] = useState(false)
  const [poolErr, setPoolErr] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txErr, setTxErr] = useState<string | null>(null)
  const [txPending, setTxPending] = useState(false)

  // Default pair to WETH / USDC.e once tokens are loaded
  useEffect(() => {
    if (!tokens.length) return
    if (!tokenA) {
      const weth = tokens.find((t) => t.symbol.toLowerCase() === 'weth')
      if (weth) setTokenA(weth.address as Address)
    }
    if (!tokenB) {
      const usdc = tokens.find((t) => {
        const s = t.symbol.toLowerCase()
        return s === 'usdc.e' || s === 'usdc'
      })
      if (usdc) setTokenB(usdc.address as Address)
    }
  }, [tokens, tokenA, tokenB])

  // Resolve token metadata
  const metaA = tokenA ? byAddr.get(tokenA.toLowerCase()) : undefined
  const metaB = tokenB ? byAddr.get(tokenB.toLowerCase()) : undefined

  const { data: balA } = useBalance({
    address,
    token: tokenA as Address,
    enabled: !!address && !!tokenA,
    watch: true,
  })

  const { data: balB } = useBalance({
    address,
    token: tokenB as Address,
    enabled: !!address && !!tokenB,
    watch: true,
  })

  function formatBalance(
    value: bigint | undefined,
    decimals: number | undefined,
    symbol?: string
  ) {
    if (value === undefined || decimals === undefined) return '-'
    try {
      const num = Number(formatUnits(value, decimals))
      if (!Number.isFinite(num)) return '-'
      return `${num.toFixed(4)}${symbol ? ` ${symbol}` : ''}`
    } catch {
      return '-'
    }
  }

  // Detect pool + tick spacing → full-range ticks
  useEffect(() => {
    let active = true
    async function run() {
      setPoolErr(null)
      setPoolAddress(null)
      setTickLower(null)
      setTickUpper(null)
      setTxHash(null)

      if (!publicClient || !tokenA || !tokenB) return
      if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
        setPoolErr('Select two different tokens')
        return
      }

      setLoadingPool(true)
      try {
        const pool = await getPoolAddress(publicClient as any, tokenA, tokenB, fee)
        if (!pool || pool === '0x0000000000000000000000000000000000000000') {
          if (active) setPoolErr('Pool not initialized for this pair / fee')
          return
        }
        const state = await getPoolState(publicClient as any, pool)
        const { tickLower, tickUpper } = getFullRangeTicks(state.tickSpacing)
        if (!active) return
        setPoolAddress(pool)
        setTickLower(tickLower)
        setTickUpper(tickUpper)
      } catch (e: any) {
        if (active) setPoolErr(e?.message || 'Failed to load pool')
      } finally {
        if (active) setLoadingPool(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [publicClient, tokenA, tokenB, fee])

  // Parse amounts with correct decimals based on *user* order
  const amountAWei = useMemo(() => {
    if (!metaA) return 0n
    try {
      return parseUnits(amountA || '0', metaA.decimals ?? 18)
    } catch {
      return 0n
    }
  }, [amountA, metaA])

  const amountBWei = useMemo(() => {
    if (!metaB) return 0n
    try {
      return parseUnits(amountB || '0', metaB.decimals ?? 18)
    } catch {
      return 0n
    }
  }, [amountB, metaB])

  async function ensureAllowance(token: Address, amount: bigint) {
    if (!walletClient || !publicClient || !address) return
    if (amount === 0n) return
    const current = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address as Address, UNI_V3_ADDRESSES.positionManager as Address],
    })) as bigint
    if (current >= amount) return
    await walletClient.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [UNI_V3_ADDRESSES.positionManager as Address, 2n ** 256n - 1n],
    })
  }

  async function onAdd() {
    setTxErr(null)
    setTxHash(null)
    if (!walletClient || !publicClient || !address) {
      setTxErr('Connect wallet first')
      return
    }
    if (!tokenA || !tokenB || !metaA || !metaB) {
      setTxErr('Select tokens first')
      return
    }
    if (!poolAddress || tickLower == null || tickUpper == null) {
      setTxErr('Pool not ready yet')
      return
    }
    if (amountAWei === 0n && amountBWei === 0n) {
      setTxErr('Enter an amount for at least one side')
      return
    }

    // Uniswap v3 requires token0 < token1
    const [token0, token1] =
      tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]

    const isA0 = tokenA.toLowerCase() === token0.toLowerCase()

    const amount0Desired = isA0 ? amountAWei : amountBWei
    const amount1Desired = isA0 ? amountBWei : amountAWei

    // For now, don't enforce min amounts – let NFPM take the correct ratio
    // and refund any unused tokens. We'll wire proper math + true slippage
    // protection later.
    const amount0Min = 0n
    const amount1Min = 0n

    try {
      setTxPending(true)

      // Approvals for both sides (if needed)
      await ensureAllowance(token0, amount0Desired)
      await ensureAllowance(token1, amount1Desired)

      const deadline = BigInt(
        Math.floor(Date.now() / 1000) +
          Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20) * 60
      )

      const hash = await walletClient.writeContract({
        address: UNI_V3_ADDRESSES.positionManager as Address,
        abi: nfpmAbi,
        functionName: 'mint',
        args: [
          {
            token0: token0 as Address,
            token1: token1 as Address,
            fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired,
            amount1Desired,
            amount0Min,
            amount1Min,
            recipient: address as Address,
            deadline,
          },
        ],
        value: 0n,
      })

      setTxHash(hash as string)
    } catch (e: any) {
      setTxErr(e?.shortMessage || e?.message || 'Mint failed')
    } finally {
      setTxPending(false)
    }
  }

  const disableAdd =
    !address ||
    !tokenA ||
    !tokenB ||
    !!poolErr ||
    loadingPool ||
    (amountAWei === 0n && amountBWei === 0n)

  return (
    <div className="max-w-2xl mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">Add Liquidity</div>
        <div className="text-xs opacity-70">Full range position (v1)</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <TokenInput label="Token A" value={tokenA} onChange={setTokenA} />
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>
                Amount A {metaA ? `(${metaA.symbol})` : ''}
              </span>
              <span>
                Balance:{' '}
                {balA
                  ? formatBalance(balA.value, balA.decimals, metaA?.symbol)
                  : '-'}
              </span>
            </div>
            <input
              className="w-full bg-neutral-800 p-2 rounded"
              placeholder="0.0"
              value={amountA}
              onChange={(e) => setAmountA(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          <TokenInput label="Token B" value={tokenB} onChange={setTokenB} />
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>
                Amount B {metaB ? `(${metaB.symbol})` : ''}
              </span>
              <span>
                Balance:{' '}
                {balB
                  ? formatBalance(balB.value, balB.decimals, metaB?.symbol)
                  : '-'}
              </span>
            </div>
            <input
              className="w-full bg-neutral-800 p-2 rounded"
              placeholder="0.0"
              value={amountB}
              onChange={(e) => setAmountB(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
        <div className="text-right opacity-80">
          <div>Fee tier: {(fee / 10000).toFixed(2)}%</div>
          {/* v2: make selectable + auto-suggest */}
        </div>
      </div>

      <div className="text-xs bg-neutral-900/70 rounded-xl p-3 space-y-1">
        <div className="flex justify-between">
          <span className="opacity-70">Pool</span>
          <span className="font-mono text-[11px]">
            {poolAddress
              ? `${poolAddress.slice(0, 6)}…${poolAddress.slice(-4)}`
              : loadingPool
              ? 'Loading…'
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Range</span>
          <span>
            {tickLower != null && tickUpper != null
              ? `${tickLower} → ${tickUpper} (full range)`
              : '—'}
          </span>
        </div>
      </div>

      {poolErr && (
        <div className="text-xs text-amber-400">
          {poolErr}
        </div>
      )}
      {txErr && (
        <div className="text-xs text-red-400">
          {txErr}
        </div>
      )}
      {txHash && (
        <div className="text-xs text-emerald-400 break-all">
          Mint tx: {txHash}
        </div>
      )}

      <button
        className="btn w-full"
        onClick={onAdd}
        disabled={disableAdd || txPending}
      >
        {txPending ? 'Adding liquidity…' : 'Add liquidity'}
      </button>
    </div>
  )
}