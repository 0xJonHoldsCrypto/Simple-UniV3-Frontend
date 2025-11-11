import { Address, encodeFunctionData } from 'viem'
import { UNI_V3_ADDRESSES } from '../addresses'

export function buildMintPosition({
  token0,
  token1,
  fee,
  tickLower,
  tickUpper,
  amount0Desired,
  amount1Desired,
  amount0Min,
  amount1Min,
  recipient,
  deadline,
}: any) {
  return {
    to: UNI_V3_ADDRESSES.positionManager as Address,
    data: encodeFunctionData({
      abi: [
        {
          name: 'mint',
          type: 'function',
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
      ],
      functionName: 'mint',
      args: [
        {
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min,
          amount1Min,
          recipient,
          deadline,
        },
      ],
    }),
    value: 0n,
  }
}