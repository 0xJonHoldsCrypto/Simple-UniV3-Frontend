export const Q96 = 2n ** 96n
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0=18, decimals1=18) {
  // price = (sqrtPriceX96^2 / 2^192) * 10^(decimals0 - decimals1)
  const num = sqrtPriceX96 * sqrtPriceX96
  const denom = Q96 * Q96
  const ratio = Number(num) / Number(denom)
  return ratio * 10 ** (decimals0 - decimals1)
}