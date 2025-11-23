import SwapCard from "@/features/swap/SwapCard";
import type { Address } from "viem";

type SearchParams = Record<string, string | string[] | undefined>;

export default function Page({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const tokenIn =
    typeof searchParams?.tokenIn === "string"
      ? (searchParams.tokenIn as Address)
      : undefined;

  const tokenOut =
    typeof searchParams?.tokenOut === "string"
      ? (searchParams.tokenOut as Address)
      : undefined;

  const fee =
    typeof searchParams?.fee === "string"
      ? Number(searchParams.fee)
      : undefined;

  const amountIn =
    typeof searchParams?.amountIn === "string"
      ? searchParams.amountIn
      : undefined;

  return (
    <SwapCard
      initialTokenIn={tokenIn}
      initialTokenOut={tokenOut}
      initialFee={Number.isFinite(fee) ? fee : undefined}
      initialAmountIn={amountIn}
    />
  );
}