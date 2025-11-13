// src/lib/univ3/position.ts
import type { Address } from 'viem'
import { encodeFunctionData } from 'viem'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'

const nfpmAbi = [
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'owner',type:'address'}], outputs:[{name:'balance',type:'uint256'}] },
  { type:'function', name:'tokenOfOwnerByIndex', stateMutability:'view', inputs:[{name:'owner',type:'address'},{name:'index',type:'uint256'}], outputs:[{name:'tokenId',type:'uint256'}] },
  { type:'function', name:'positions', stateMutability:'view', inputs:[{name:'tokenId',type:'uint256'}], outputs:[
    {name:'nonce',type:'uint96'},
    {name:'operator',type:'address'},
    {name:'token0',type:'address'},
    {name:'token1',type:'address'},
    {name:'fee',type:'uint24'},
    {name:'tickLower',type:'int24'},
    {name:'tickUpper',type:'int24'},
    {name:'liquidity',type:'uint128'},
    {name:'feeGrowthInside0LastX128',type:'uint256'},
    {name:'feeGrowthInside1LastX128',type:'uint256'},
    {name:'tokensOwed0',type:'uint128'},
    {name:'tokensOwed1',type:'uint128'},
  ] },
] as const

export type RawPosition = {
  id: bigint
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  liquidity: bigint
  tokensOwed0: bigint
  tokensOwed1: bigint
}

// Uniswap v3 global min/max ticks
export const TICK_MIN = -887272
export const TICK_MAX = 887272

/**
 * Given a tickSpacing, compute a sane full-range [tickLower, tickUpper]
 * that is aligned to the spacing.
 */
export function getFullRangeTicks(tickSpacing: number) {
  const lower = Math.floor(TICK_MIN / tickSpacing) * tickSpacing
  const upper = Math.floor(TICK_MAX / tickSpacing) * tickSpacing
  return { tickLower: lower, tickUpper: upper }
}

/**
 * Low-level helper: builds calldata for NFPM.mint.
 * (We’re currently calling writeContract directly with the ABI,
 * but this stays here in case you want to manually construct txs.)
 */
export function buildMintPosition(params: {
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  recipient: Address
  deadline: bigint
}) {
  const abi = [
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

  return {
    to: UNI_V3_ADDRESSES.positionManager as Address,
    data: encodeFunctionData({
      abi,
      functionName: 'mint',
      args: [params],
    }),
    value: 0n,
  }
}

export async function fetchUserPositions(client: any, owner: Address): Promise<RawPosition[]> {
  if (!client || !owner) return []

  const balance = await client.readContract({
    address: UNI_V3_ADDRESSES.positionManager as Address,
    abi: nfpmAbi,
    functionName: 'balanceOf',
    args: [owner],
  }) as bigint

  const n = Number(balance)
  if (!n || Number.isNaN(n)) return []

  const ids = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      client.readContract({
        address: UNI_V3_ADDRESSES.positionManager as Address,
        abi: nfpmAbi,
        functionName: 'tokenOfOwnerByIndex',
        args: [owner, BigInt(i)],
      }) as Promise<bigint>
    )
  )

  const raw = await Promise.all(
    ids.map((id) =>
      client.readContract({
        address: UNI_V3_ADDRESSES.positionManager as Address,
        abi: nfpmAbi,
        functionName: 'positions',
        args: [id],
      }) as Promise<any>
    )
  )

  return raw.map((p, idx) => {
    const id = ids[idx]
    return {
      id,
      token0: p[2] as Address,
      token1: p[3] as Address,
      fee: Number(p[4]),
      tickLower: Number(p[5]),
      tickUpper: Number(p[6]),
      liquidity: BigInt(p[7]),
      tokensOwed0: BigInt(p[10]),
      tokensOwed1: BigInt(p[11]),
    }
  })
}