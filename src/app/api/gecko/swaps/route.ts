import { NextResponse } from "next/server";

export const runtime = "edge"; // fine on Vercel; remove if you prefer node

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pool = searchParams.get("pool");
  if (!pool) {
    return NextResponse.json(
      { error: "missing pool param" },
      { status: 400 }
    );
  }

  const addr = pool.toLowerCase();

  // GeckoTerminal v2 trades endpoint (no pair_id required)
  const url =
    `https://api.geckoterminal.com/api/v2/networks/hemi/pools/${addr}/trades` +
    `?include=base_token,quote_token&page=1`;

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      // UA helps avoid occasional CF weirdness on serverless
      "user-agent": "swap3/1.0 (+https://swap3.app)",
    },
    // keep it fresh-ish without hammering
    next: { revalidate: 15 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Gecko ${res.status}: ${body}` },
      { status: res.status }
    );
  }

  const json = await res.json();

  // Map v2 trades → the p1-like shape your UI already renders
  const data = (json?.data ?? []).map((t: any) => {
    const a = t?.attributes ?? {};
    return {
      id: t?.id,
      type: "swap",
      attributes: {
        block_timestamp: a.block_timestamp ?? a.timestamp ?? null,
        tx_hash: a.tx_hash ?? null,
        from_token_amount:
          a.base_token_amount ?? a.from_token_amount ?? null,
        to_token_amount:
          a.quote_token_amount ?? a.to_token_amount ?? null,
        price_in_usd: a.price_in_usd ?? null,
        volume_in_usd:
          a.volume_in_usd ?? a.trade_volume_in_usd ?? null,
        kind: a.trade_type ?? a.kind ?? null,
      },
    };
  });

  return NextResponse.json({ data });
}