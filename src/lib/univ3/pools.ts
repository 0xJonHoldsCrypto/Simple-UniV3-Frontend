// src/lib/univ3/pools.ts
import type { Address } from 'viem'
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

export async function getPoolAddress(
  client: any,
  a: Address,
  b: Address,
  fee: number,
): Promise<Address> {
  return client.readContract({
    address: UNI_V3_ADDRESSES.factory as Address,
    abi: factoryAbi,
    functionName: 'getPool',
    args: [a, b, fee],
  }) as Promise<Address>
}

export async function getPoolState(client: any, pool: Address) {
  const [slot0, liq, spacing] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' }),
    client.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity' }),
    client.readContract({ address: pool, abi: poolAbi, functionName: 'tickSpacing' }),
  ])
  return {
    slot0,
    liquidity: liq as bigint,
    tickSpacing: Number(spacing),
  }
}