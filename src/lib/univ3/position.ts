// src/lib/univ3/position.ts
import type { Address } from 'viem'
import { encodeFunctionData } from 'viem'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'

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