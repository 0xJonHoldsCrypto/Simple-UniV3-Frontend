import { encodeFunctionData, parseUnits, Address } from 'viem'
import { UNI_V3_ADDRESSES } from '../addresses'

export function buildExactInputSingle({
  tokenIn,
  tokenOut,
  fee,
  recipient,
  amountIn,
  amountOutMinimum,
  deadline,
}: {
  tokenIn: Address
  tokenOut: Address
  fee: number
  recipient: Address
  amountIn: bigint
  amountOutMinimum: bigint
  deadline: bigint
}) {
  return {
    to: UNI_V3_ADDRESSES.swapRouter as Address,
    data: encodeFunctionData({
      abi: [
        {
          name: 'exactInputSingle',
          type: 'function',
          stateMutability: 'payable',
          inputs: [
            {
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
            },
          ],
          outputs: [{ name: 'amountOut', type: 'uint256' }],
        },
      ],
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          fee,
          recipient,
          deadline,
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
    value: 0n,
  }
}