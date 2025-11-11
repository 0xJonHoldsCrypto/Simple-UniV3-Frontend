export const UNI_V3_ADDRESSES = {
  // Core Uniswap v3
  factory: process.env.NEXT_PUBLIC_UNI_FACTORY ?? '0x346239972d1fa486FC4a521031BC81bFB7D6e8a4',
  positionManager: process.env.NEXT_PUBLIC_UNI_NFPM ?? '0xEFdE184f4b5d79f7c3b7Efc0388d829ff9af0050',
  quoterV2: process.env.NEXT_PUBLIC_UNI_QUOTER_V2 ?? '0xcBa55304013187D49d4012F4d7e4B63a04405cd5',
  swapRouter: process.env.NEXT_PUBLIC_UNI_SWAP_ROUTER ?? '0x864DDc9B50B9A0dF676d826c9B9EDe9F8913a160', // SwapRouter02

  // Infra
  multicall2: process.env.NEXT_PUBLIC_MULTICALL2 ?? '0x352A86168e6988A1aDF9A15Cb00017AAd3B67155',
  // Some libs/tools your UI may use later
  tickLens: process.env.NEXT_PUBLIC_TICK_LENS ?? '0xA9d71E1dd7ca26F26e656E66d6AA81ed7f745bf0',
  v3Migrator: process.env.NEXT_PUBLIC_V3_MIGRATOR ?? '0x7d133a1Ff7B2E552beb6480A30cdfF70A4C5aa62',
  v3Staker: process.env.NEXT_PUBLIC_V3_STAKER ?? '0xa7122672F68B247Cb18e2b9903F430EF5D28cc56',
  universalRouter: process.env.NEXT_PUBLIC_UNIVERSAL_ROUTER ?? '0x533c7A53389e0538AB6aE1D7798D6C1213eAc28B',
  permit2: process.env.NEXT_PUBLIC_PERMIT2 ?? '0xB952578f3520EE8Ea45b7914994dcf4702cEe578',
  limitOrderRegistry: process.env.NEXT_PUBLIC_LIMIT_ORDER_REGISTRY ?? '0xcd7f266E3C0D0771897aAF74BEB38072D66402A0',

  // Wrapped native (REQUIRED: please set this to the WETH-equivalent on Hemi)
  weth: process.env.NEXT_PUBLIC_WRAPPED_NATIVE ?? '0x4200000000000000000000000000000000000006',
} as const

export type UniAddresses = typeof UNI_V3_ADDRESSES

