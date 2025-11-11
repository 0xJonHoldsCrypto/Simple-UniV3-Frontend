'use client'
import { useEffect, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import type { Address } from 'viem'
import { UNI_V3_ADDRESSES } from '@/lib/addresses'

const nfpmAbi = [
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'a',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'tokenOfOwnerByIndex', stateMutability:'view', inputs:[{name:'a',type:'address'},{name:'i',type:'uint256'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'positions', stateMutability:'view', inputs:[{name:'id',type:'uint256'}], outputs:[
    {name:'nonce',type:'uint96'}, {name:'operator',type:'address'}, {name:'token0',type:'address'}, {name:'token1',type:'address'},
    {name:'fee',type:'uint24'}, {name:'tickLower',type:'int24'}, {name:'tickUpper',type:'int24'}, {name:'liquidity',type:'uint128'},
    {name:'feeGrowthInside0LastX128',type:'uint256'}, {name:'feeGrowthInside1LastX128',type:'uint256'}, {name:'tokensOwed0',type:'uint128'}, {name:'tokensOwed1',type:'uint128'}
  ] }
]

export default function PositionsTable(){
  const { address } = useAccount()
  const client = usePublicClient()
  const [rows, setRows] = useState<any[]>([])

  useEffect(()=>{
    let active = true
    async function run(){
      if (!client || !address) return
      const bal = await client.readContract({ address: UNI_V3_ADDRESSES.positionManager as Address, abi: nfpmAbi, functionName:'balanceOf', args:[address] }) as bigint
      const n = Number(bal)
      const ids = await Promise.all([...Array(n)].map((_,i)=> client.readContract({ address: UNI_V3_ADDRESSES.positionManager as Address, abi: nfpmAbi, functionName:'tokenOfOwnerByIndex', args:[address, BigInt(i)] }) ))
      const pos = await Promise.all(ids.map((id)=> client.readContract({ address: UNI_V3_ADDRESSES.positionManager as Address, abi: nfpmAbi, functionName:'positions', args:[id as bigint] })))
      if (active) setRows(pos.map((pp, i) => {
        const p: any = pp as any
        return {
          id: String(ids[i]),
          token0: p[2] as string,
          token1: p[3] as string,
          fee: Number(p[4]),
          tl: Number(p[5]),
          tu: Number(p[6]),
          liq: String(p[7]),
        }
      }))
    }
    run(); return ()=>{ active=false }
  }, [client, address])

  return (
    <div className="overflow-x-auto text-sm">
      <table className="w-full">
        <thead className="text-left opacity-80">
          <tr><th>ID</th><th>Token0</th><th>Token1</th><th>Fee</th><th>Tick L</th><th>Tick U</th><th>Liquidity</th></tr>
        </thead>
        <tbody>
          {rows.map(r=> (
            <tr key={r.id} className="border-t border-neutral-800">
              <td>{r.id}</td><td>{r.token0}</td><td>{r.token1}</td><td>{r.fee}</td><td>{r.tl}</td><td>{r.tu}</td><td>{r.liq}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}