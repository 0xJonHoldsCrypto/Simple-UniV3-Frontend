// src/lib/univ3/quotes.ts
import type { Address } from "viem";
import { parseUnits } from "viem";
import { UNI_V3_ADDRESSES } from "@/lib/addresses";
import { getPoolAddress } from "./pools";

// QuoterV2: quoteExactInputSingle(QuoteExactInputSingleParams)
// struct QuoteExactInputSingleParams {
//   address tokenIn;
//   address tokenOut;
//   uint256 amountIn;        // ← BEFORE fee
//   uint24  fee;
//   uint160 sqrtPriceLimitX96;
// }
const quoterV2Abi = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" }, // ✅ correct position
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export async function quoteExactInSingle(
  client: any,
  {
    tokenIn,
    tokenOut,
    fee,
    amountInHuman,
    decimalsIn,
  }: {
    tokenIn: Address;
    tokenOut: Address;
    fee: number;
    amountInHuman: string;
    decimalsIn: number;
  }
): Promise<bigint> {
  // 1) Ensure pool exists for this fee tier
  const pool = await getPoolAddress(client, tokenIn, tokenOut, fee);
  if (!pool || pool === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Pool not found for fee ${fee / 10000}%`);
  }

  // 2) Scale input precisely
  const amountIn = parseUnits(amountInHuman || "0", decimalsIn);
  if (amountIn === 0n) {
    throw new Error("Enter a non-zero amount");
  }

  // 3) Quote via QuoterV2 (struct arg, correct order)
  const [amountOut] = (await client.readContract({
    address: UNI_V3_ADDRESSES.quoterV2 as Address,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn, // ✅ before fee
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })) as readonly [bigint, bigint, number, bigint];

  return amountOut ?? 0n;
}
