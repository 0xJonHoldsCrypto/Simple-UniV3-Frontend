import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GECKO_BASE = "https://api.geckoterminal.com/api/v2";

// IMPORTANT: set this to the same network slug you used in your existing
// /api/gecko/pool route. (Whatever is working for TVL/volume right now.)
const NETWORK = process.env.GECKO_NETWORK_SLUG || "hemi";

export async function GET(
  _req: Request,
  { params }: { params: { pool: string } }
) {
  const pool = params.pool?.toLowerCase();
  if (!pool || !pool.startsWith("0x") || pool.length !== 42) {
    return NextResponse.json({ error: "Invalid pool" }, { status: 400 });
  }

  const url = `${GECKO_BASE}/networks/${NETWORK}/pools/${pool}/trades`;

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // Gecko caches anyway; we don't want *our* layer caching:
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Gecko trades fetch failed: ${res.status}`, body },
      { status: res.status }
    );
  }

  const json = await res.json();
  return NextResponse.json(json);
}