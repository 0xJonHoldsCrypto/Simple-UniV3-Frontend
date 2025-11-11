import type { Address } from 'viem'
import { encodeFunctionData } from 'viem'
import { UNI_V3_ADDRESSES } from '../addresses'

// Public ABI for SwapRouter02.exactInputSingle so callers can use writeContract
export const swapRouterAbi = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

export type ExactInputSingleParams = {
  tokenIn: Address
  tokenOut: Address
  fee: number
  recipient: Address
  deadline: bigint
  amountIn: bigint
  amountOutMinimum: bigint
  sqrtPriceLimitX96?: bigint
}

// Keep the helper for callers that prefer to pre-encode data
export function buildExactInputSingle({
  tokenIn,
  tokenOut,
  fee,
  recipient,
  amountIn,
  amountOutMinimum,
  deadline,
}: ExactInputSingleParams) {
  return {
    to: UNI_V3_ADDRESSES.swapRouter as Address,
    data: encodeFunctionData({
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      }],
    }),
    value: 0n,
  }
}