import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pool = searchParams.get("pool");

  if (!pool || !pool.startsWith("0x") || pool.length !== 42) {
    return NextResponse.json({ error: "Invalid pool address" }, { status: 400 });
  }

  const url =
    `https://api.geckoterminal.com/api/v2/networks/hemi/pools/${pool.toLowerCase()}` +
    `?include=base_token,quote_token&include_volume_breakdown=true&include_composition=true`;

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // keep it freshish but cacheable on the edge if you want
    next: { revalidate: 30 },
  });

  const text = await res.text();

  if (!res.ok) {
    return NextResponse.json(
      { error: `Gecko ${res.status}: ${text}` },
      { status: res.status }
    );
  }

  return new NextResponse(text, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}