// src/lib/univ3/pools.ts
import type { Address } from 'viem'
import { zeroAddress } from 'viem'
import { UNI_V3_ADDRESSES } from '../addresses'

const factoryAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getPool',
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
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'tickSpacing',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'int24' }],
  },
] as const

function sortTokens(a: Address, b: Address) {
  const aL = a.toLowerCase()
  const bL = b.toLowerCase()
  if (aL === bL) throw new Error('tokenIn and tokenOut cannot be the same')
  const inverted = aL > bL // if true, caller order is token1,token0
  return {
    token0: inverted ? b : a,
    token1: inverted ? a : b,
    inverted,
  }
}

/**
 * Returns the pool address for (a,b,fee) using UniswapV3 sorting (token0<token1).
 * If no pool exists, returns zero address.
 */
export async function getPoolAddress(
  client: any,
  a: Address,
  b: Address,
  fee: number,
): Promise<Address> {
  const { token0, token1 } = sortTokens(a, b)
  return client.readContract({
    address: UNI_V3_ADDRESSES.factory as Address,
    abi: factoryAbi,
    functionName: 'getPool',
    args: [token0, token1, fee],
  }) as Promise<Address>
}

/**
 * Convenience: returns null if no pool, plus whether caller order was inverted.
 */
export async function findPool(
  client: any,
  a: Address,
  b: Address,
  fee: number,
): Promise<{ pool: Address; token0: Address; token1: Address; inverted: boolean } | null> {
  const { token0, token1, inverted } = sortTokens(a, b)
  const pool = await client.readContract({
    address: UNI_V3_ADDRESSES.factory as Address,
    abi: factoryAbi,
    functionName: 'getPool',
    args: [token0, token1, fee],
  }) as Address

  if (!pool || pool.toLowerCase() === zeroAddress) return null
  return { pool, token0, token1, inverted }
}

/**
 * Same as findPool, but throws a readable error if missing.
 */
export async function requirePool(
  client: any,
  a: Address,
  b: Address,
  fee: number,
): Promise<{ pool: Address; token0: Address; token1: Address; inverted: boolean }> {
  const res = await findPool(client, a, b, fee)
  if (!res) throw new Error(`Pool not found for selected fee tier (${(fee/10000).toFixed(2)}%)`)
  return res
}

/**
 * Reads core state from a V3 pool.
 * Adds an `initialized` boolean (sqrtPriceX96 > 0n).
 */
export async function getPoolState(client: any, pool: Address) {
  const [slot0, liq, spacing] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' }),
    client.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity' }),
    client.readContract({ address: pool, abi: poolAbi, functionName: 'tickSpacing' }),
  ])

  const sqrtPriceX96 = (slot0 as any)?.[0] as bigint
  const initialized = typeof sqrtPriceX96 === 'bigint' && sqrtPriceX96 > 0n

  return {
    slot0,
    initialized,
    liquidity: liq as bigint,
    tickSpacing: Number(spacing),
  }
}