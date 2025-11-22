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
    name: 'createAndInitializePoolIfNecessary',
    stateMutability: 'payable',
    inputs: [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
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

  // 0.30% default (matches OKU WETH/USDC.e pool on Hemi)
  const [fee, setFee] = useState(3000)

  const [amountA, setAmountA] = useState('0.1')
  const [amountB, setAmountB] = useState('100')

  const [slippageBps, setSlippageBps] = useState(
    Number(process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 50),
  )

  const [poolAddress, setPoolAddress] = useState<Address | null>(null)
  const [tickLower, setTickLower] = useState<number | null>(null)
  const [tickUpper, setTickUpper] = useState<number | null>(null)
  const [tickSpacing, setTickSpacing] = useState<number | null>(null)
  const [currentTick, setCurrentTick] = useState<number | null>(null)
  const [rangePreset, setRangePreset] = useState<'full' | '50' | '20' | '10'>('full')
  const [manualRange, setManualRange] = useState(false)
  const [minPriceInput, setMinPriceInput] = useState('')
  const [maxPriceInput, setMaxPriceInput] = useState('')
  const [currentPrice, setCurrentPrice] = useState<number | null>(null) // tokenB per tokenA
  // UI toggle: show price as tokenB per tokenA (default) or inverted
  const [invertPrice, setInvertPrice] = useState(false)
  const [minPrice, setMinPrice] = useState<number | null>(null)
  const [maxPrice, setMaxPrice] = useState<number | null>(null)
  const [lastEdited, setLastEdited] = useState<'A' | 'B' | null>(null)
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
    query: {
      enabled: !!address && !!tokenA,
      refetchInterval: 10_000,
    },
  })

  const { data: balB } = useBalance({
    address,
    token: tokenB as Address,
    query: {
      enabled: !!address && !!tokenB,
      refetchInterval: 10_000,
    },
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

  function formatPrice(p: number | null, decimals = 6) {
    if (p == null || !Number.isFinite(p)) return '—'
    const abs = Math.abs(p)
    // Use compact exponential for extreme values
    if (abs !== 0 && (abs >= 1e9 || abs < 1e-6)) return p.toExponential(4)
    return p.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
    })
  }

  // Canonical Uniswap V3 tick-spacing per fee tier
  function feeToTickSpacing(fee: number): number {
    switch (fee) {
      case 100: return 1
      case 500: return 10
      case 3000: return 60
      case 10000: return 200
      default: return 60 // safe fallback
    }
  }

  // Safe derive price (token1 per token0, decimals-adjusted) from sqrtPriceX96
  function priceFromSqrtPriceX96(
    sqrtX96: bigint,
    dec0: number,
    dec1: number,
  ): number {
    if (sqrtX96 <= 0n) return NaN
    const num = sqrtX96 * sqrtX96 // Q192
    const Q192 = 2n ** 192n
    const scale = 10n ** 18n
    const ratioX18 = (num * scale) / Q192 // raw token1/token0 * 1e18
    const rawRatio = Number(ratioX18) / 1e18
    if (!Number.isFinite(rawRatio) || rawRatio <= 0) return NaN
    return rawRatio * Math.pow(10, dec0 - dec1)
  }

  const LN_1_0001 = Math.log(1.0001)
  const clampTick = (t: number) => Math.max(-887272, Math.min(887272, t))

  // Ensure tick alignment stays integer-safe (avoid float modulo issues)
  function alignTick(t: number, spacing: number, dir: 'down' | 'up') {
    const clamped = clampTick(t)
    const q = clamped / spacing
    const alignedQ = dir === 'down' ? Math.floor(q) : Math.ceil(q)
    return clampTick(Math.trunc(alignedQ * spacing))
  }

  function sortTokens(a: Address, b: Address): [Address, Address] {
    return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  }

  function priceFromTick(tick: number, dec0: number, dec1: number): number {
    const t = Number(tick)
    const d0 = Number(dec0)
    const d1 = Number(dec1)
    if (!Number.isFinite(t) || !Number.isFinite(d0) || !Number.isFinite(d1)) return NaN
    // price of token1 per token0
    const p = Math.pow(1.0001, t) * Math.pow(10, d0 - d1)
    return p
  }

  function tickFromPrice(price: number, dec0: number, dec1: number): number {
    const p = Number(price)
    const d0 = Number(dec0)
    const d1 = Number(dec1)
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(d0) || !Number.isFinite(d1)) return NaN
    const base = p / Math.pow(10, d0 - d1)
    return Math.log(base) / LN_1_0001
  }
  function derivePricesFromTicks(
    tokenA: Address,
    tokenB: Address,
    metaA: any,
    metaB: any,
    curTick: number,
    lowerTick: number,
    upperTick: number,
  ) {
    const [token0, token1] = sortTokens(tokenA, tokenB)
    const tokenAIs0 = tokenA.toLowerCase() === token0.toLowerCase()

    const meta0 = token0.toLowerCase() === tokenA.toLowerCase() ? metaA : metaB
    const meta1 = token1.toLowerCase() === tokenA.toLowerCase() ? metaA : metaB

    const dec0 = Number(meta0?.decimals ?? 18)
    const dec1 = Number(meta1?.decimals ?? 18)

    const pCur0 = priceFromTick(Number(curTick), dec0, dec1)
    const pLower0 = priceFromTick(Number(lowerTick), dec0, dec1)
    const pUpper0 = priceFromTick(Number(upperTick), dec0, dec1)

    // Convert to tokenB per tokenA (UI convention)
    const curUI = tokenAIs0 ? pCur0 : 1 / pCur0
    const lowerUI = tokenAIs0 ? pLower0 : 1 / pUpper0
    const upperUI = tokenAIs0 ? pUpper0 : 1 / pLower0

    const minUI = Math.min(lowerUI, upperUI)
    const maxUI = Math.max(lowerUI, upperUI)

    return {
      currentPrice: curUI,
      minPrice: minUI,
      maxPrice: maxUI,
    }
  }
  function ticksFromPercent(
    curTick: number,
    spacing: number,
    pct: number,
  ): { tickLower: number; tickUpper: number } {
    // pct is e.g. 50 meaning +/-50% around current price.
    const up = Math.log(1 + pct / 100) / LN_1_0001
    const down = Math.log(1 - pct / 100) / LN_1_0001
    const rawLower = curTick + down
    const rawUpper = curTick + up

    const alignedLower = alignTick(rawLower, spacing, 'down')
    const alignedUpper = alignTick(rawUpper, spacing, 'up')

    return {
      tickLower: alignedLower,
      tickUpper: alignedUpper,
    }
  }

 function ticksFromPreset(
  curTick: number,
  spacing: number,
  preset: 'full' | '50' | '20' | '10',
) {
  if (preset === 'full') {
    // Full range MUST be aligned to spacing AND stay within TickMath MIN/MAX.
    // So we round *toward zero* (inside the bounds), not outward.
    const fullLower = Math.trunc(Math.ceil(-887272 / spacing) * spacing)
    const fullUpper = Math.trunc(Math.floor(887272 / spacing) * spacing)
    return { tickLower: fullLower, tickUpper: fullUpper }
  }

  const pct = preset === '50' ? 50 : preset === '20' ? 20 : 10
  return ticksFromPercent(curTick, spacing, pct)
}

  // Detect pool + tick spacing → preset ticks
  useEffect(() => {
    let active = true
    async function run() {
      setPoolErr(null)
      setPoolAddress(null)
      setTickLower(null)
      setTickUpper(null)
      setTickSpacing(null)
      setCurrentTick(null)
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
        if (!active) return

        // Defensive extraction for tick and tickSpacing, with fallback to sqrtPriceX96
        // Different RPCs / deployments sometimes return slot0 instead of flat fields.
        const rawTick =
          (state as any).tick ??
          (state as any).slot0?.tick ??
          (state as any).slot0?.[1]

        const rawSqrt =
          (state as any).sqrtPriceX96 ??
          (state as any).slot0?.sqrtPriceX96 ??
          (state as any).slot0?.[0]

        let curTickNum = Number(rawTick)

        // If tick is missing but sqrtPriceX96 exists, derive price then tick.
        if (!Number.isFinite(curTickNum) && rawSqrt != null) {
          try {
            const [token0, token1] = sortTokens(tokenA, tokenB)
            const meta0 = token0.toLowerCase() === tokenA.toLowerCase() ? metaA : metaB
            const meta1 = token1.toLowerCase() === tokenA.toLowerCase() ? metaA : metaB
            const dec0 = Number(meta0?.decimals ?? 18)
            const dec1 = Number(meta1?.decimals ?? 18)

            const p0 = priceFromSqrtPriceX96(BigInt(rawSqrt), dec0, dec1)
            if (Number.isFinite(p0) && p0 > 0) {
              curTickNum = tickFromPrice(p0, dec0, dec1)
            }
          } catch {
            curTickNum = NaN
          }
        }

        let spacingNum = Number((state as any).tickSpacing)
        if (!Number.isFinite(spacingNum)) {
          spacingNum = feeToTickSpacing(fee)
        }

        if (!Number.isFinite(curTickNum)) {
          console.warn('[AddLiquidity] non-numeric tick data', { rawTick, rawSqrt, state })
          if (active) setPoolErr('Pool state returned non-numeric tick data')
          return
        }

        setPoolAddress(pool)
        setTickSpacing(spacingNum)
        setCurrentTick(curTickNum)

        const { tickLower, tickUpper } = ticksFromPreset(curTickNum, spacingNum, rangePreset)
        setTickLower(tickLower)
        setTickUpper(tickUpper)
        if (metaA && metaB) {
          const prices = derivePricesFromTicks(
            tokenA,
            tokenB,
            metaA,
            metaB,
            curTickNum,
            tickLower,
            tickUpper,
          )
          if (Number.isFinite(prices.currentPrice)) setCurrentPrice(prices.currentPrice)
          else setCurrentPrice(null)
          if (Number.isFinite(prices.minPrice) && Number.isFinite(prices.maxPrice)) {
            setMinPrice(prices.minPrice)
            setMaxPrice(prices.maxPrice)
          } else {
            setMinPrice(null)
            setMaxPrice(null)
          }
        } else {
          setCurrentPrice(null)
          setMinPrice(null)
          setMaxPrice(null)
        }
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
  }, [publicClient, tokenA, tokenB, fee, rangePreset, manualRange, metaA, metaB])

  useEffect(() => {
    if (!manualRange) return
    if (currentTick == null || tickSpacing == null || !tokenA || !tokenB) return
    if (!metaA || !metaB) return

    const minP = Number(minPriceInput)
    const maxP = Number(maxPriceInput)
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || minP <= 0 || maxP <= 0) return
    if (minP >= maxP) return

    const [token0, token1] = sortTokens(tokenA, tokenB)
    const dec0 = token0.toLowerCase() === tokenA.toLowerCase() ? (metaA.decimals ?? 18) : (metaB.decimals ?? 18)
    const dec1 = token1.toLowerCase() === tokenB.toLowerCase() ? (metaB.decimals ?? 18) : (metaA.decimals ?? 18)

    const tokenAIs0 = tokenA.toLowerCase() === token0.toLowerCase()
    const minP0 = tokenAIs0 ? minP : 1 / maxP
    const maxP0 = tokenAIs0 ? maxP : 1 / minP

    const rawLower = tickFromPrice(minP0, dec0, dec1)
    const rawUpper = tickFromPrice(maxP0, dec0, dec1)

    const alignedLower = alignTick(rawLower, tickSpacing, 'down')
    const alignedUpper = alignTick(rawUpper, tickSpacing, 'up')

    setTickLower(alignedLower)
    setTickUpper(alignedUpper)
  }, [manualRange, minPriceInput, maxPriceInput, currentTick, tickSpacing, tokenA, tokenB, metaA, metaB])
  // Recompute displayed prices whenever ticks or current tick move
  useEffect(() => {
    if (!tokenA || !tokenB || !metaA || !metaB) return
    if (currentTick == null || tickLower == null || tickUpper == null) return

    const prices = derivePricesFromTicks(
      tokenA,
      tokenB,
      metaA,
      metaB,
      currentTick,
      tickLower,
      tickUpper,
    )

    if (Number.isFinite(prices.currentPrice)) setCurrentPrice(prices.currentPrice)
    else setCurrentPrice(null)

    if (Number.isFinite(prices.minPrice) && Number.isFinite(prices.maxPrice)) {
      setMinPrice(prices.minPrice)
      setMaxPrice(prices.maxPrice)
    } else {
      setMinPrice(null)
      setMaxPrice(null)
    }
  }, [tokenA, tokenB, metaA, metaB, currentTick, tickLower, tickUpper])
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

  // Fallback: derive current price directly from currentTick (tokenB per tokenA)
  const derivedCurrentPrice = useMemo<number | null>(() => {
    if (!tokenA || !tokenB || !metaA || !metaB || currentTick == null) return null

    const [token0, token1] = sortTokens(tokenA, tokenB)
    const tokenAIs0 = tokenA.toLowerCase() === token0.toLowerCase()

    const meta0 = token0.toLowerCase() === tokenA.toLowerCase() ? metaA : metaB
    const meta1 = token1.toLowerCase() === tokenA.toLowerCase() ? metaA : metaB

    const dec0 = Number(meta0?.decimals ?? 18)
    const dec1 = Number(meta1?.decimals ?? 18)
    const pCur0 = priceFromTick(Number(currentTick), dec0, dec1)
    if (!Number.isFinite(pCur0) || pCur0 <= 0) return null

    const curUI = tokenAIs0 ? pCur0 : 1 / pCur0
    return Number.isFinite(curUI) ? curUI : null
  }, [tokenA, tokenB, metaA, metaB, currentTick])

  const displayPrices = useMemo(() => {
    if (!metaA || !metaB) return null

    const symA = (metaA.symbol ?? '').toLowerCase()
    const symB = (metaB.symbol ?? '').toLowerCase()

    const isUSDC_A = symA === 'usdc' || symA === 'usdc.e'
    const isUSDC_B = symB === 'usdc' || symB === 'usdc.e'
    const isWETH_A = symA === 'weth'
    const isWETH_B = symB === 'weth'

    if (currentPrice == null || !Number.isFinite(currentPrice)) {
      return {
        cur: null as number | null,
        min: null as number | null,
        max: null as number | null,
        unit: metaB.symbol && metaA.symbol ? `${metaB.symbol}/${metaA.symbol}` : '',
      }
    }

    // Base UI convention is tokenB per tokenA
    let cur = currentPrice
    let min = minPrice
    let max = maxPrice
    let unit = metaB.symbol && metaA.symbol ? `${metaB.symbol}/${metaA.symbol}` : ''

    // If pair includes WETH and USDC(.e), force USDC per WETH as the base view.
    if ((isUSDC_A && isWETH_B) || (isUSDC_B && isWETH_A)) {
      if (isUSDC_A && isWETH_B) {
        // tokenA=USDC, tokenB=WETH => currentPrice is WETH/USDC, invert to USDC/WETH
        cur = cur !== 0 ? 1 / cur : cur
        min = maxPrice != null && maxPrice !== 0 ? 1 / maxPrice : null
        max = minPrice != null && minPrice !== 0 ? 1 / minPrice : null
        unit = `${metaA.symbol}/${metaB.symbol}` // USDC/WETH
      } else {
        // tokenA=WETH, tokenB=USDC => already correct
        unit = `${metaB.symbol}/${metaA.symbol}` // USDC/WETH
      }
    }

    // Ensure min/max ordered
    let minOrdered = min
    let maxOrdered = max
    if (
      minOrdered != null &&
      maxOrdered != null &&
      Number.isFinite(minOrdered) &&
      Number.isFinite(maxOrdered)
    ) {
      const lo = Math.min(minOrdered, maxOrdered)
      const hi = Math.max(minOrdered, maxOrdered)
      minOrdered = lo
      maxOrdered = hi
    }

    // Apply optional inversion for display
    if (invertPrice && cur != null && Number.isFinite(cur) && cur !== 0) {
      const invCur = 1 / cur
      const invMin = maxOrdered != null && Number.isFinite(maxOrdered) && maxOrdered !== 0 ? 1 / maxOrdered : null
      const invMax = minOrdered != null && Number.isFinite(minOrdered) && minOrdered !== 0 ? 1 / minOrdered : null
      const invUnit = metaA.symbol && metaB.symbol ? `${metaA.symbol}/${metaB.symbol}` : unit.split('/').reverse().join('/')

      cur = invCur
      minOrdered = invMin
      maxOrdered = invMax
      unit = invUnit
    }

    return {
      cur,
      min: minOrdered,
      max: maxOrdered,
      unit,
    }
  }, [currentPrice, minPrice, maxPrice, metaA, metaB, invertPrice])

  useEffect(() => {
    const price = derivedCurrentPrice ?? currentPrice

    // Always log once per run so we can see why it might skip
    console.log('[AddLiquidity] autofill tick/price check', {
      lastEdited,
      amountA,
      amountB,
      price,
      derivedCurrentPrice,
      currentPrice,
      currentTick,
      metaA: metaA ? { symbol: metaA.symbol, decimals: metaA.decimals } : null,
      metaB: metaB ? { symbol: metaB.symbol, decimals: metaB.decimals } : null,
    })

    if (price == null || !Number.isFinite(price)) return
    if (!metaA || !metaB) return
    if (!lastEdited) return

    if (lastEdited === 'A') {
      const aNum = Number(amountA || 0)
      if (!Number.isFinite(aNum)) return

      const bNum = aNum * price
      if (!Number.isFinite(bNum)) return

      const next = bNum
        .toFixed(6)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1')

      console.log('[AddLiquidity] computed amountB from A', {
        aNum,
        bNum,
        next,
        prevAmountB: amountB,
      })

      if (next && next !== amountB) setAmountB(next)
    } else if (lastEdited === 'B') {
      const bNum = Number(amountB || 0)
      if (!Number.isFinite(bNum)) return

      const aNum = bNum / price
      if (!Number.isFinite(aNum)) return

      const next = aNum
        .toFixed(6)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1')

      console.log('[AddLiquidity] computed amountA from B', {
        bNum,
        aNum,
        next,
        prevAmountA: amountA,
      })

      if (next && next !== amountA) setAmountA(next)
    }
  }, [amountA, amountB, currentPrice, derivedCurrentPrice, lastEdited, metaA, metaB, currentTick])

  async function ensureAllowance(token: Address, amount: bigint) {
    if (!walletClient || !publicClient || !address) return
    if (amount === 0n) return

    const spender = UNI_V3_ADDRESSES.positionManager as Address

    const current = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address as Address, spender],
    })) as bigint

    if (current >= amount) return

    const maxUint256 = (1n << 256n) - 1n

    // Send approve tx
    const hash = await walletClient.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, maxUint256],
    })

    // Wait for mining so mint doesn't run with 0 allowance
    await publicClient.waitForTransactionReceipt({ hash })
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
    if (!poolAddress || tickLower == null || tickUpper == null || tickSpacing == null) {
      setTxErr('Pool not ready yet')
      return
    }
    if (tickLower >= tickUpper) {
      setTxErr('Invalid range: min tick must be below max tick')
      return
    }
    const lowerInt = Math.trunc(tickLower)
const upperInt = Math.trunc(tickUpper)

if (lowerInt % tickSpacing !== 0 || upperInt % tickSpacing !== 0) {
  setTxErr('Invalid range: ticks must align to spacing')
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
      const msg =
        e?.shortMessage ??
        e?.message ??
        (typeof e === 'string' ? e : 'Mint failed')
      console.error('Mint failed', e)
      setTxErr(msg)
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
              onChange={(e) => {
                setLastEdited('A')
                setAmountA(e.target.value)
              }}
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
              onChange={(e) => {
                setLastEdited('B')
                setAmountB(e.target.value)
              }}
            />
          </div>
        </div>
      </div>

    <div className="flex items-center justify-between text-sm">
  <SlippageControl value={slippageBps} onChange={setSlippageBps} />
  <div className="text-right opacity-80 flex items-center gap-2">
    <label className="text-xs opacity-70">Fee tier</label>
    <select
      className="bg-neutral-800 rounded px-2 py-1 text-sm"
      value={fee}
      onChange={(e) => {
        const nextFee = Number(e.target.value)
        setFee(nextFee)
        setManualRange(false)
        setRangePreset('full')
      }}
    >
      <option value={100}>0.01%</option>
      <option value={300}>0.03%</option>
      <option value={500}>0.05%</option>
      <option value={3000}>0.30%</option>
      <option value={10000}>1.00%</option>
    </select>
  </div>
</div>

      <div className="bg-neutral-900/70 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Range</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setManualRange((v) => !v)}
              className={`px-2 py-1 rounded text-xs ${
                manualRange
                  ? 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40'
                  : 'bg-neutral-800 hover:bg-neutral-700'
              }`}
            >
              Manual
            </button>
            <div className="flex gap-2">
              {([
                { key: 'full', label: 'Full' },
                { key: '50', label: '50%' },
                { key: '20', label: '20%' },
                { key: '10', label: '10%' },
              ] as const).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setManualRange(false)
                    setRangePreset(r.key)
                  }}
                  className={`px-2 py-1 rounded text-xs ${
                    rangePreset === r.key && !manualRange
                      ? 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40'
                      : 'bg-neutral-800 hover:bg-neutral-700'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="text-[11px] opacity-70">
          {currentTick != null && tickSpacing != null && tickLower != null && tickUpper != null
            ? `Ticks: ${tickLower} → ${tickUpper} (spacing ${tickSpacing})`
            : 'Ticks will appear once pool loads.'}
        </div>

        <div className="text-[11px] opacity-70">
          {displayPrices?.cur != null && metaA && metaB ? (
            <>
              <div className="flex items-center gap-2">
                <div>
                  Current price: {formatPrice(displayPrices.cur, 4)} {displayPrices.unit}
                </div>
                <button
                  type="button"
                  onClick={() => setInvertPrice((v) => !v)}
                  className="px-2 py-0.5 rounded text-[10px] bg-neutral-800 hover:bg-neutral-700 opacity-80"
                  title="Flip price quote"
                  aria-label="Flip price quote"
                >
                  ↔
                </button>
              </div>
              {rangePreset === 'full' && !manualRange ? (
                <div>Min/Max: Full range</div>
              ) : (
                <div>
                  Min/Max: {formatPrice(displayPrices.min, 4)} → {formatPrice(displayPrices.max, 4)} {displayPrices.unit}
                </div>
              )}
            </>
          ) : (
            <div>Price info will appear once pool loads.</div>
          )}
        </div>

        {manualRange && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="text-[11px] opacity-70">
              Min price ({metaB?.symbol} per {metaA?.symbol})
              <input
                className="mt-1 w-full bg-neutral-800 p-2 rounded text-sm"
                placeholder="0.00"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
              />
            </label>
            <label className="text-[11px] opacity-70">
              Max price ({metaB?.symbol} per {metaA?.symbol})
              <input
                className="mt-1 w-full bg-neutral-800 p-2 rounded text-sm"
                placeholder="0.00"
                value={maxPriceInput}
                onChange={(e) => setMaxPriceInput(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div className="text-xs bg-neutral-900/70 rounded-xl p-3 space-y-1">
        <div className="flex justify-between">
          <span className="opacity-70">Pool</span>
          <span className="font-mono text-[11px]">
            {poolAddress ? (
              <a
                href={`https://explorer.hemi.xyz/address/${poolAddress}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:opacity-80"
              >
                {poolAddress}
              </a>
            ) : loadingPool ? (
              'Loading…'
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Range</span>
          <span>
            {rangePreset === 'full' && !manualRange ? (
              tickLower != null && tickUpper != null ? (
                `Full range (ticks ${tickLower} → ${tickUpper})`
              ) : (
                'Full range'
              )
              ) : displayPrices?.min != null && displayPrices?.max != null && metaA && metaB ? (
              `${formatPrice(displayPrices.min, 4)} → ${formatPrice(displayPrices.max, 4)} ${displayPrices.unit}`
            ) : tickLower != null && tickUpper != null ? (
              `${tickLower} → ${tickUpper}`
            ) : (
              '—'
            )}
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