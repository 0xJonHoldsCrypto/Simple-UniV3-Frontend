'use client'
import { useAccount, useWalletClient } from 'wagmi'
import type { Address } from 'viem'
import { buildMintPosition } from '@/lib/univ3/position'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'

const erc20Abi = [
  { type:'function', name:'approve', stateMutability:'nonpayable', inputs:[{name:'s',type:'address'},{name:'v',type:'uint256'}], outputs:[{type:'bool'}] },
]

export default function AddLiquidityCard(){
  const { address } = useAccount()
  const { data: wallet } = useWalletClient()
  async function onMint(){
    if (!wallet || !address) return
    // TODO: compute ticks & desired amounts based on UI range selection
    const params:any = {
      token0: '0x...' as Address,
      token1: '0x...' as Address,
      fee: 3000,
      tickLower: -60000,
      tickUpper: -50000,
      amount0Desired: 0n,
      amount1Desired: 0n,
      amount0Min: 0n,
      amount1Min: 0n,
      recipient: address as Address,
      deadline: BigInt(Math.floor(Date.now()/1000)+1200),
    }
    // pre-approve tokens to NFPM if needed
    // await wallet.writeContract({ address: params.token0, abi: erc20Abi, functionName:'approve', args:[UNI_V3_ADDRESSES.positionManager as Address, params.amount0Desired] })
    // await wallet.writeContract({ address: params.token1, abi: erc20Abi, functionName:'approve', args:[UNI_V3_ADDRESSES.positionManager as Address, params.amount1Desired] })
    const tx = buildMintPosition(params)
    await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value })
  }
  return (
    <div className="max-w-2xl mx-auto rounded-2xl p-4 bg-neutral-900 shadow">
      <div className="text-xl font-semibold mb-3">Add Liquidity</div>
      {/* TODO: Token selectors, range slider, amount inputs */}
      <button className="btn btn-primary" onClick={onMint}>Mint Position</button>
    </div>
  )
}