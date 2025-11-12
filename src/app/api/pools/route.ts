// src/app/api/pools/route.ts
import tokenlist from '@/lib/tokenlist.json'
import { NextResponse } from 'next/server'
import { createPublicClient, http, type Address } from 'viem'
import { safeMulticall } from '@/lib/viem/safeMulticall'

export const dynamic = 'force-dynamic' // ensure fresh in dev; cache via KV instead

type Token = {
  address: string
  chainId: number
  decimals: number
  symbol: string
  name: string
  logoURI?: string
}

const FEES: number[] = [100, 500, 3000, 10000]

// Minimal ABIs
const factoryAbi = [
  { type: 'function', name: 'getPool', stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

const poolAbi = [
  { type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [
    { name:'sqrtPriceX96', type:'uint160' },
    { name:'tick', type:'int24' },
    { name:'observationIndex', type:'uint16' },
    { name:'observationCardinality', type:'uint16' },
    { name:'observationCardinalityNext', type:'uint16' },
    { name:'feeProtocol', type:'uint8' },
    { name:'unlocked', type:'bool' },
  ]},
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type:'uint128' }] },
  { type: 'function', name: 'tickSpacing', stateMutability: 'view', inputs: [], outputs: [{ type:'int24' }] },
] as const

// --- Upstash KV helpers (REST) ---
const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN
async function kvGet<T>(key: string): Promise<T | null> {
  if (!KV_URL || !KV_TOKEN) return null
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: 'no-store',
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.result ? (JSON.parse(j.result) as T) : null
  } catch { return null }
}
async function kvSet<T>(key: string, value: T, ttlSeconds = 3600) {
  if (!KV_URL || !KV_TOKEN) return
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: ttlSeconds }),
    })
  } catch { /* ignore */ }
}

// viem multicall chunking helper with auto-fallback to per-call reads
async function multicallChunked<T extends { address: Address; abi: any; functionName: any; args?: any[] }>(
  client: any,
  contracts: T[],
  chunkSize = 150
) {
  const out: any[] = []
  for (let i = 0; i < contracts.length; i += chunkSize) {
    const slice = contracts.slice(i, i + chunkSize)

    // Try multicall (may be unsupported/misconfigured)
    let res: any[] = []
    let okShare = 0
    try {
      const r = await safeMulticall(client, slice)
      res = Array.isArray(r) ? r : (Array.isArray((r as any)?.results) ? (r as any).results : [])
      okShare = res.filter((x: any) => x && x.status === 'success').length / (res.length || 1)
    } catch {
      // ignore, we'll fallback below
    }

    // If multicall failed hard (no results) or success rate is tiny, do direct per-call
    if (!res.length || okShare < 0.05) {
      const direct = await Promise.all(
        slice.map((c) =>
          (client as any)
            .readContract(c)
            .then((result: any) => ({ status: 'success', result }))
            .catch(() => ({ status: 'failure' }))
        )
      )
      out.push(...direct)
    } else {
      out.push(...res)
    }
  }
  return out
}

// Robust extractors to tolerate different multicall shapes
function asSuccess(obj: any) {
  return obj && typeof obj === 'object' && 'status' in obj ? obj : null
}
function unwrapResult<T = any>(obj: any): T | null {
  // viem multicall v1: { status:'success', result }
  const s = asSuccess(obj)
  if (s) return s.status === 'success' ? (s.result as T) : null
  // direct readContract: returns the value directly
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'bigint') return obj as T
  // sometimes an array/tuple is returned directly
  if (Array.isArray(obj)) return obj as unknown as T
  return null
}
function unwrapAddress(obj: any): Address | null {
  const v = unwrapResult<any>(obj)
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (s === '0x' || s.length < 42) return null
    return v as Address
  }
  if (Array.isArray(v) && typeof v[0] === 'string') {
    const s = (v[0] as string).toLowerCase()
    if (s === '0x' || s.length < 42) return null
    return v[0] as Address
  }
  return null
}

export async function GET(req: Request) {
  try {
    const FACTORY = (process.env.NEXT_PUBLIC_UNI_FACTORY || '').toLowerCase() as Address
    const RPC = process.env.NEXT_PUBLIC_RPC_URL
    const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '0')

    if (!FACTORY || !RPC || !CHAIN_ID) {
      return NextResponse.json(
        { error: 'Missing envs: NEXT_PUBLIC_UNI_FACTORY / NEXT_PUBLIC_RPC_URL / NEXT_PUBLIC_CHAIN_ID' },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(req.url)
    const debug = searchParams.get('debug') === '1'
    const force = searchParams.get('refresh') === '1'
    const CACHE_KEY = `pools:v2:${CHAIN_ID}`

    // Filter token list for chain
    const list = (tokenlist.tokens as Token[]).filter((t) => t.chainId === CHAIN_ID)
    if (!list.length) {
      return NextResponse.json({ error: `No tokens for chainId ${CHAIN_ID} in tokenlist`, count: 0 }, { status: 400 })
    }

    if (!force) {
      const cached = await kvGet<any[]>(CACHE_KEY)
      if (cached?.length) {
        return NextResponse.json(cached, {
          headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
        })
      }
    }

    const client = createPublicClient({
    chain: {
  id: CHAIN_ID,
  name: 'Hemi',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
  contracts: {
    multicall3: {
      address: (process.env.NEXT_PUBLIC_MULTICALL3 ?? process.env.NEXT_PUBLIC_MULTICALL2) as `0x${string}`,
      blockCreated: 0,
    },
  },
},
      transport: http(RPC!),
    })

    // Optional: safety cap tokens to keep pair count reasonable during debugging
    const MAX_TOKENS = 120
    const listCapped = list.slice(0, MAX_TOKENS)
    // Rebuild addrs/pairs using capped list
    const addrs = [...new Set(listCapped.map((t) => t.address.toLowerCase()))]
    if (!listCapped.length) {
      return NextResponse.json({ error: `No tokens for chain ${CHAIN_ID} in tokenlist` }, { status: 400 })
    }

    // Pair generation (A<B) to avoid duplicates
    const pairs: [Address, Address][] = []
    for (let i = 0; i < addrs.length; i++) {
      for (let j = i + 1; j < addrs.length; j++) pairs.push([addrs[i] as Address, addrs[j] as Address])
    }

    // Safety cap; raise later if desired
    const MAX_PAIRS = 4000
    const pairsCapped = pairs.slice(0, MAX_PAIRS)

    // Probe getPool for each (pair, fee)
    const zero = '0x0000000000000000000000000000000000000000'
    const calls = []
    for (const [a, b] of pairsCapped) for (const fee of FEES) {
      const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
      calls.push({ address: FACTORY, abi: factoryAbi, functionName: 'getPool' as const, args: [t0, t1, fee] })
    }

    let poolRes: any[] = []
    try {
      poolRes = await multicallChunked(client, calls, 200)
    } catch (e) {
      // Fallback: direct per-call reads (slower, but guarantees results)
      poolRes = await Promise.all(
        calls.map((c) =>
          (client as any)
            .readContract(c)
            .then((result: any) => ({ status: 'success', result }))
            .catch(() => ({ status: 'failure' }))
        )
      )
    }

    const found: { pool: Address; token0: Address; token1: Address; fee: number }[] = []
    let k = 0
    for (const [a, b] of pairsCapped) {
      for (const fee of FEES) {
        const r = poolRes[k++]
        const pool = unwrapAddress(r) || (zero as Address)
        if (pool && pool.toLowerCase() !== zero) {
          const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
          found.push({ pool, token0: t0, token1: t1, fee })
        }
      }
    }

    async function diagKnownPair() {
      try {
        // Try a very common pair: WETH / USDC(.e) @ 0.3%
        const bySym = new Map(listCapped.map(t => [t.symbol.toLowerCase(), t]))
        const weth = bySym.get('weth')
        const usdc = bySym.get('usdc.e') ?? bySym.get('usdc')
        if (!weth || !usdc) return { note: 'No WETH/USDC in tokenlist for this chain.' }
        const a = (weth.address as string).toLowerCase() as Address
        const b = (usdc.address as string).toLowerCase() as Address
        const [t0, t1] = a < b ? [a, b] : [b, a]
        const pool: Address = await (client as any).readContract({
          address: FACTORY,
          abi: factoryAbi,
          functionName: 'getPool',
          args: [t0, t1, 3000],
        })
        return {
          pair: { weth: weth.address, usdc: usdc.address, fee: 3000 },
          pool,
        }
      } catch (e: any) {
        return { error: e?.message || 'direct getPool failed' }
      }
    }

// If multicall likely broke (0 pools), brute-force a smaller scan with direct reads only.
if (!found.length) {
  const zero = '0x0000000000000000000000000000000000000000'
  // Try a smaller, direct-only pass (fee 3000 first; most pools use 0.3%)
  const FEES_FALLBACK = [3000, 500, 100, 10000] as const
  const pairsSmall = pairsCapped.slice(0, Math.min(pairsCapped.length, 1500))
  const callsSmall: any[] = []
  for (const [a, b] of pairsSmall) {
    for (const fee of FEES_FALLBACK) {
      const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
      callsSmall.push({ address: FACTORY, abi: factoryAbi, functionName: 'getPool' as const, args: [t0, t1, fee] })
    }
  }
  const resSmall = await Promise.all(
    callsSmall.map((c) =>
      (client as any)
        .readContract(c)
        .then((result: any) => ({ status: 'success', result }))
        .catch(() => ({ status: 'failure' }))
    )
  )
  let k2 = 0
  for (const [a, b] of pairsSmall) {
    for (const fee of FEES_FALLBACK) {
      const r = resSmall[k2++]
      const v = (r && r.status === 'success') ? (r.result as string) : zero
      if (v && v.toLowerCase() !== zero) {
        const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
        found.push({ pool: v as Address, token0: t0, token1: t1, fee })
      }
    }
  }
}

    if (!found.length) {
      const diag = await diagKnownPair()
      const payload = debug
        ? {
            tokens: listCapped.length,
            pairsTried: pairsCapped.length,
            poolsFound: 0,
            sampleDiag: diag,
            env: {
              chainId: CHAIN_ID,
              factory: FACTORY,
              rpc: RPC ? `${RPC.slice(0, 24)}…` : null,
              multicall: (process.env.NEXT_PUBLIC_MULTICALL3 ?? process.env.NEXT_PUBLIC_MULTICALL2) || null,
            },
          }
        : []
      if (!debug) await kvSet(CACHE_KEY, [], 300)
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
    }

    // Per-pool state
    const stateCalls = found.flatMap((f) => ([
      { address: f.pool, abi: poolAbi, functionName: 'slot0' as const, args: [] },
      { address: f.pool, abi: poolAbi, functionName: 'liquidity' as const, args: [] },
      { address: f.pool, abi: poolAbi, functionName: 'tickSpacing' as const, args: [] },
    ]))
    const stateRes = await multicallChunked(client, stateCalls, 150)

    const rows = []
    for (let i = 0; i < found.length; i++) {
      const r0 = stateRes[i * 3 + 0] as any
      const r1 = stateRes[i * 3 + 1] as any
      const r2 = stateRes[i * 3 + 2] as any

      const s0Raw = unwrapResult<any>(r0)
      const liqRaw = unwrapResult<any>(r1)
      const spcRaw = unwrapResult<any>(r2) as number | bigint | null
      const s0 = s0Raw ? s0Raw as any : null
      const liq = typeof liqRaw === 'bigint' ? liqRaw : (Array.isArray(liqRaw) ? (liqRaw[0] as bigint) : undefined)

      const spc = typeof spcRaw === 'bigint' ? Number(spcRaw) : (spcRaw ?? 0)

      rows.push({
        pool: found[i].pool,
        token0: found[i].token0,
        token1: found[i].token1,
        fee: found[i].fee,
        tickSpacing: spc,
        liquidity: liq ? String(liq) : '0',
        slot0: s0 ? { sqrtPriceX96: String(s0[0] as bigint), tick: Number(s0[1] as number) } : null,
      })
    }

    // decorate with token meta (optional)
    const byAddr = new Map(addrs.map((a) => [a, listCapped.find((t) => t.address.toLowerCase() === a)!]))
    const withMeta = rows.map((r) => ({
      ...r,
      t0: byAddr.get(r.token0.toLowerCase()) && {
        symbol: byAddr.get(r.token0.toLowerCase())!.symbol,
        name:   byAddr.get(r.token0.toLowerCase())!.name,
        address:byAddr.get(r.token0.toLowerCase())!.address,
        decimals:byAddr.get(r.token0.toLowerCase())!.decimals,
        logoURI:byAddr.get(r.token0.toLowerCase())!.logoURI,
      },
      t1: byAddr.get(r.token1.toLowerCase()) && {
        symbol: byAddr.get(r.token1.toLowerCase())!.symbol,
        name:   byAddr.get(r.token1.toLowerCase())!.name,
        address:byAddr.get(r.token1.toLowerCase())!.address,
        decimals:byAddr.get(r.token1.toLowerCase())!.decimals,
        logoURI:byAddr.get(r.token1.toLowerCase())!.logoURI,
      },
    }))

    await kvSet(CACHE_KEY, withMeta, 3600)
    if (debug) {
      return NextResponse.json({ tokens: listCapped.length, pairsTried: pairsCapped.length, poolsFound: withMeta.length, sample: withMeta.slice(0, 5) })
    }
    return NextResponse.json(withMeta, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    })
  } catch (err: any) {
    // Always JSON, never HTML
    return NextResponse.json(
      { error: err?.message || 'Internal error', stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined },
      { status: 500 }
    )
  }
}