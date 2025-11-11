'use client'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { useState } from 'react'
import type { Address } from 'viem'
import { buildExactInputSingle } from '@/lib/univ3/swap'
import { useQuote } from '@/hooks/useQuote'
import TokenInput from '@/components/TokenInput'

const erc20Abi = [
  { type:'function', name:'allowance', stateMutability:'view', inputs:[{name:'o',type:'address'},{name:'s',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'approve', stateMutability:'nonpayable', inputs:[{name:'s',type:'address'},{name:'v',type:'uint256'}], outputs:[{type:'bool'}] },
]
import { UNI_V3_ADDRESSES } from '@/lib/addresses'

export default function SwapCard(){
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [form, setForm] = useState({
    tokenIn: '' as Address,
    tokenOut: '' as Address,
    fee: 3000,
    amountIn: '0.1',
    slippageBps: Number(process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 50),
  })

  const amountInWei = BigInt(Math.floor(Number(form.amountIn || '0') * 1e18))
  const { amountOut, minOut, loading: quoting } = useQuote({
    client: publicClient,
    tokenIn: form.tokenIn,
    tokenOut: form.tokenOut,
    amountInWei,
    fee: form.fee,
    slippageBps: form.slippageBps,
  })

  async function ensureAllowance(){
    if (!walletClient || !address || !form.tokenIn) return
    const allowance = await publicClient!.readContract({ address: form.tokenIn, abi: erc20Abi, functionName:'allowance', args:[address as Address, UNI_V3_ADDRESSES.swapRouter as Address] }) as bigint
    if (allowance >= amountInWei) return
    await walletClient.writeContract({ address: form.tokenIn, abi: erc20Abi, functionName:'approve', args:[UNI_V3_ADDRESSES.swapRouter as Address, amountInWei] })
  }

  async function onSwap(){
    if (!walletClient || !publicClient || !address) return
    await ensureAllowance()
    const deadline = BigInt(Math.floor(Date.now()/1000) + Number(process.env.NEXT_PUBLIC_TX_DEADLINE_MIN ?? 20)*60)
    const tx = buildExactInputSingle({
      tokenIn: form.tokenIn,
      tokenOut: form.tokenOut,
      fee: form.fee,
      recipient: address as Address,
      amountIn: amountInWei,
      amountOutMinimum: minOut,
      deadline,
    })
    await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value })
  }

  return (
    <div className="max-w-lg mx-auto rounded-2xl p-4 bg-neutral-900 shadow space-y-3">
      <div className="text-xl font-semibold">Swap</div>
      <TokenInput label="Token In" onChange={(a)=>setForm(f=>({...f, tokenIn: a}))} />
      <TokenInput label="Token Out" onChange={(a)=>setForm(f=>({...f, tokenOut: a}))} />
      <input className="w-full bg-neutral-800 p-2 rounded" placeholder="Amount In" defaultValue={form.amountIn} onChange={(e)=>setForm(f=>({...f, amountIn: e.target.value}))} />
      <div className="opacity-80 text-sm">Quoted out: {amountOut ? String(amountOut) : (quoting?'…':'-')}</div>
      <div className="opacity-80 text-sm">Min out (slippage {form.slippageBps/100}%): {String(minOut)}</div>
      <button className="btn w-full" onClick={onSwap}>Swap</button>
    </div>
  )
}