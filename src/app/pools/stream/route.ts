import tokenlist from '@/lib/tokenlist.json'
import { NextResponse } from 'next/server'
import { createPublicClient, http, type Address } from 'viem'
import { safeMulticall } from '@/lib/viem/safeMulticall'

export const dynamic = 'force-dynamic'

const FEES = [100, 500, 3000, 10000]
const factoryAbi = [
  { type:'function', name:'getPool', stateMutability:'view',
    inputs:[{name:'tokenA',type:'address'},{name:'tokenB',type:'address'},{name:'fee',type:'uint24'}],
    outputs:[{name:'pool',type:'address'}] },
] as const
const poolAbi = [
  { type:'function', name:'slot0', stateMutability:'view', inputs:[], outputs:[
    {name:'sqrtPriceX96',type:'uint160'},{name:'tick',type:'int24'},
    {name:'observationIndex',type:'uint16'},{name:'observationCardinality',type:'uint16'},
    {name:'observationCardinalityNext',type:'uint16'},{name:'feeProtocol',type:'uint8'},{name:'unlocked',type:'bool'},
  ]},
  { type:'function', name:'liquidity', stateMutability:'view', inputs:[], outputs:[{type:'uint128'}] },
  { type:'function', name:'tickSpacing', stateMutability:'view', inputs:[], outputs:[{type:'int24'}] },
] as const

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

export async function GET() {
  const FACTORY = (process.env.NEXT_PUBLIC_UNI_FACTORY || '').toLowerCase() as Address
  const RPC = process.env.NEXT_PUBLIC_RPC_URL!
  const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '0')

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
    transport: http(RPC),
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const list = (tokenlist.tokens as any[]).filter(t => t.chainId === CHAIN_ID)
        if (!list.length) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: `No tokens for chainId ${CHAIN_ID} in tokenlist`, count: 0 })+'\n'))
          controller.close()
          return
        }
        const MAX_TOKENS = 120
        const listCapped = list.slice(0, MAX_TOKENS)
        const addrs = [...new Set(listCapped.map(t => t.address.toLowerCase()))]
        const pairs: [Address, Address][] = []
        for (let i=0;i<addrs.length;i++) for (let j=i+1;j<addrs.length;j++) pairs.push([addrs[i] as Address, addrs[j] as Address])

        const MAX_PAIRS = 4000
        const zero = '0x0000000000000000000000000000000000000000'

        // Probe in small chunks so we can stream results frequently
        const chunk = async <T,>(arr:T[], n=200) => { for(let i=0;i<arr.length;i+=n) yield arr.slice(i,i+n) }
        // @ts-ignore: using for-await
        for await (const batch of chunk(pairs, 100)) {
          // build calls
          const calls = []
          for (const [a,b] of batch) for (const fee of FEES) {
            const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
            calls.push({ address: FACTORY, abi: factoryAbi, functionName:'getPool' as const, args:[t0, t1, fee] })
          }
          let res: any[] = []
          try {
            const r = await safeMulticall(client as any, calls)
            res = Array.isArray(r) ? r : (Array.isArray((r as any)?.results) ? (r as any).results : [])
          } catch {
            res = await Promise.all(
              calls.map((c) =>
                (client as any)
                  .readContract(c)
                  .then((result: any) => ({ status: 'success', result }))
                  .catch(() => ({ status: 'failure' }))
              )
            )
          }
          let k=0
          for (const [a,b] of batch) {
            for (const fee of FEES) {
              const r = res[k++]
              const pool = unwrapAddress(r) || (zero as Address)
              if (pool && pool.toLowerCase() !== zero) {
                {
                  const r = await safeMulticall(client as any, [
                    { address: pool, abi: poolAbi, functionName:'slot0' as const, args: [] },
                    { address: pool, abi: poolAbi, functionName:'liquidity' as const, args: [] },
                    { address: pool, abi: poolAbi, functionName:'tickSpacing' as const, args: [] },
                  ])
                  const state = Array.isArray(r) ? r : (Array.isArray((r as any)?.results) ? (r as any).results : [])
                  const slot0 = unwrapResult<any>(state[0])
                  const liq = unwrapResult<any>(state[1])
                  const spacing = unwrapResult<any>(state[2])
                  const line = JSON.stringify({
                    pool, token0:a, token1:b, fee,
                    tickSpacing: Number((spacing as any) ?? 0),
                    liquidity: String((liq as any) ?? '0'),
                    slot0: slot0 ? { sqrtPriceX96: String((slot0 as any)[0]), tick: Number((slot0 as any)[1]) } : null,
                  }) + '\n'
                  controller.enqueue(encoder.encode(line))
                }
              }
            }
          }
        }
        controller.close()
      } catch (e:any) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: e?.message || 'stream error' })+'\n'))
        controller.close()
      }
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    }
  })
}