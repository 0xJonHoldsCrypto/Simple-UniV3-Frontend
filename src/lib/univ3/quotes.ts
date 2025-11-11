import { getContract, readContract, parseUnits, Address } from 'viem'
import { UNI_V3_ADDRESSES } from '../addresses'

export async function quoteExactInSingle({
  client,
  tokenIn,
  tokenOut,
  amountIn,
  fee, // 100 | 500 | 3000 | 10000 (0.01%, 0.05%, 0.3%, 1%)
}: {
  client: any
  tokenIn: Address
  tokenOut: Address
  amountIn: string
  fee: number
}) {
  return readContract(client, {
    address: UNI_V3_ADDRESSES.quoterV2 as Address,
    abi: [
      {
        name: 'quoteExactInputSingle',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        outputs: [
          { name: 'amountOut', type: 'uint256' },
        ],
      },
    ],
    functionName: 'quoteExactInputSingle',
    args: [tokenIn, tokenOut, BigInt(amountIn), fee, 0n],
  })
}