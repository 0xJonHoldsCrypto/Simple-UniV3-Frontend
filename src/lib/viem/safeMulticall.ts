// src/lib/viem/safeMulticall.ts
import type { PublicClient } from 'viem'

type ContractCall = {
  address: `0x${string}`
  abi: any
  functionName: string
  args?: readonly unknown[]
}

type MultiResult<T = any> =
  | { status: 'success'; result: T }
  | { status: 'failure'; error?: unknown }

export async function safeMulticall(
  client: PublicClient,
  contracts: ContractCall[],
): Promise<MultiResult[]> {
  const hasMulticall =
    !!client.chain?.contracts?.multicall3?.address

  if (hasMulticall) {
    // viem’s built-in multicall path
    return (await client.multicall({
      contracts: contracts as any,
      allowFailure: true,
    })) as MultiResult[]
  }

  // Fallback: run calls one-by-one
  const out: MultiResult[] = []
  for (const c of contracts) {
    try {
      const result = await client.readContract(c as any)
      out.push({ status: 'success', result })
    } catch (error) {
      out.push({ status: 'failure', error })
    }
  }
  return out
}