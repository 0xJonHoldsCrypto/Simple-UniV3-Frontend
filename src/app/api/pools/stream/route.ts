// src/app/api/pools/stream/route.ts
import tokenlist from '@/lib/tokenlist.json'
import { NextResponse } from 'next/server'
import { createPublicClient, http, type Address } from 'viem'

export const dynamic = 'force-dynamic'

const FEES = [100, 500, 3000, 10000]

const factoryAbi = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

const poolAbi = [
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
  {
    type: 'function',
    name: 'liquidity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'tickSpacing',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'int24' }],
  },
] as const

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
    },
    transport: http(RPC),
  })

  const encoder = new TextEncoder()
  const zero = '0x0000000000000000000000000000000000000000'

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const list = (tokenlist.tokens as any[]).filter((t) => t.chainId === CHAIN_ID)
        const MAX_TOKENS = 120
        const listCapped = list.slice(0, MAX_TOKENS)
        const addrs = [...new Set(listCapped.map((t) => t.address.toLowerCase()))]

        const pairs: [Address, Address][] = []
        for (let i = 0; i < addrs.length; i++) {
          for (let j = i + 1; j < addrs.length; j++) {
            pairs.push([addrs[i] as Address, addrs[j] as Address])
          }
        }

        const MAX_PAIRS = 4000
        const cappedPairs = pairs.slice(0, MAX_PAIRS)

        // Initial diag line
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'diag',
              tokens: listCapped.length,
              uniqueAddresses: addrs.length,
              pairsTotal: pairs.length,
              pairsCapped: cappedPairs.length,
            }) + '\n',
          ),
        )

        let emitted = 0

        // Helper: chunk big arrays a bit so we don't blast RPC in one huge call
        async function* chunk<T>(arr: T[], n = 200) {
          for (let i = 0; i < arr.length; i += n) {
            yield arr.slice(i, i + n)
          }
        }

        // @ts-ignore for-await
        for await (const batch of chunk(cappedPairs, 50)) {
          // Build getPool calls for this batch
          const calls: {
            pair: [Address, Address]
            fee: number
            args: [Address, Address, number]
          }[] = []

          for (const [a, b] of batch) {
            for (const fee of FEES) {
              const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
              calls.push({
                pair: [a, b],
                fee,
                args: [t0, t1, fee],
              })
            }
          }

          // Actually call getPool for each (no multicall / no magic)
          const results = await Promise.all(
            calls.map((c) =>
              client
                .readContract({
                  address: FACTORY,
                  abi: factoryAbi,
                  functionName: 'getPool',
                  args: c.args,
                })
                .catch(() => zero),
            ),
          )

          // For each non-zero pool, fetch state directly (slot0, liquidity, spacing)
          for (let idx = 0; idx < calls.length; idx++) {
            const pool = (results[idx] as Address) || (zero as Address)
            if (!pool || pool.toLowerCase() === zero) continue

            const { pair, fee } = calls[idx]
            const [token0, token1] = pair

            try {
              const [slot0Raw, liqRaw, spacingRaw] = await Promise.all([
                client.readContract({
                  address: pool,
                  abi: poolAbi,
                  functionName: 'slot0',
                }) as Promise<any>,
                client.readContract({
                  address: pool,
                  abi: poolAbi,
                  functionName: 'liquidity',
                }) as Promise<bigint>,
                client.readContract({
                  address: pool,
                  abi: poolAbi,
                  functionName: 'tickSpacing',
                }) as Promise<number | bigint>,
              ])

              const liq = liqRaw as bigint
              const tickSpacing =
                typeof spacingRaw === 'bigint' ? Number(spacingRaw) : (spacingRaw as number)

              const slot0Arr = slot0Raw as any[]
              const sqrtPriceX96 = slot0Arr?.[0]
              const tick = slot0Arr?.[1]

              const line = JSON.stringify({
                type: 'pool',
                pool,
                token0,
                token1,
                fee,
                tickSpacing,
                liquidity: liq.toString(),
                slot0: {
                  sqrtPriceX96: sqrtPriceX96?.toString?.() ?? String(sqrtPriceX96),
                  tick: Number(tick),
                },
              }) + '\n'

              controller.enqueue(encoder.encode(line))
              emitted++
            } catch {
              // ignore failed pools, keep going
            }
          }
        }

        controller.enqueue(
          encoder.encode(JSON.stringify({ type: 'summary', poolsEmitted: emitted }) + '\n'),
        )
        controller.close()
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: 'error', message: e?.message || 'stream error' }) + '\n',
          ),
        )
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}