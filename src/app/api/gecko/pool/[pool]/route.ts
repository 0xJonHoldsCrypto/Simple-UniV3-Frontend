// src/app/api/gecko/pool/[pool]/route.ts
import { NextResponse } from "next/server"

async function fetchPoolV2(id: string) {
  const baseUrl = `https://api.geckoterminal.com/api/v2/networks/hemi/pools/${id}`
  const qs = new URLSearchParams({
    include: "base_token,quote_token",
    include_volume_breakdown: "true",
    include_composition: "true",
  })

  const res = await fetch(`${baseUrl}?${qs.toString()}`, {
    headers: {
      accept: "application/json",
      "user-agent": "swap3-frontend/1.0 (+https://swap3.app)",
    },
    cache: "no-store",
  })

  const text = await res.text()
  return { res, text }
}

async function fetchOhlcvV2(id: string, timeframe: string, params: URLSearchParams) {
  const baseUrl = `https://api.geckoterminal.com/api/v2/networks/hemi/pools/${id}/ohlcv/${timeframe}`
  const res = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: {
      accept: "application/json",
      "user-agent": "swap3-frontend/1.0 (+https://swap3.app)",
    },
    cache: "no-store",
  })
  const text = await res.text()
  return { res, text }
}

export async function GET(
  req: Request,
  { params }: { params: { pool: string } }
) {
  const pool = params.pool
  if (!pool) {
    return NextResponse.json({ error: "Missing pool param" }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)

  // -----------------------------
  // OHLCV proxy mode:
  // /api/gecko/pool/:pool?ohlcv=day&aggregate=1&limit=100...
  // -----------------------------
  const ohlcvTf = searchParams.get("ohlcv") // "day" | "hour" | "minute"
  if (ohlcvTf) {
    let id = pool.toLowerCase().trim()
    if (id.startsWith("hemi_")) id = id.slice(5)

    const ohlcvQs = new URLSearchParams({
      aggregate: searchParams.get("aggregate") ?? "1",
      limit: searchParams.get("limit") ?? "100",
      currency: searchParams.get("currency") ?? "usd",
      include_empty_intervals: searchParams.get("include_empty_intervals") ?? "false",
      token: searchParams.get("token") ?? "base",
    })
    if (searchParams.get("before_timestamp")) {
      ohlcvQs.set("before_timestamp", searchParams.get("before_timestamp")!)
    }

    let { res, text } = await fetchOhlcvV2(id, ohlcvTf, ohlcvQs)

    if (res.status === 404) {
      const hemiId = `hemi_${id}`
      ;({ res, text } = await fetchOhlcvV2(hemiId, ohlcvTf, ohlcvQs))
    }

    if (res.status === 404) {
      return NextResponse.json(
        { data: null, meta: { not_indexed: true } },
        {
          status: 200,
          headers: { "cache-control": "public, max-age=20, s-maxage=60" },
        }
      )
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Gecko ${res.status}: ${text}` },
        { status: res.status }
      )
    }

    try {
      return NextResponse.json(JSON.parse(text), {
        status: 200,
        headers: { "cache-control": "public, max-age=20, s-maxage=60" },
      })
    } catch {
      return NextResponse.json({ error: "Invalid Gecko JSON" }, { status: 502 })
    }
  }

  // -----------------------------
  // Pool stats mode (default)
  // -----------------------------
  let addr = pool.toLowerCase().trim()
  if (addr.startsWith("hemi_")) addr = addr.slice(5)

  // attempt #1: plain 0x…
  let { res, text } = await fetchPoolV2(addr)

  // attempt #2 if 404: try hemi_0x…
  if (res.status === 404) {
    const hemiId = `hemi_${addr}`
    ;({ res, text } = await fetchPoolV2(hemiId))
  }

  if (res.status === 404) {
    return NextResponse.json(
      { data: null, meta: { not_indexed: true } },
      {
        status: 200,
        headers: { "cache-control": "public, max-age=20, s-maxage=60" },
      }
    )
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Gecko ${res.status}: ${text}` },
      { status: res.status }
    )
  }

  try {
    return NextResponse.json(JSON.parse(text), {
      status: 200,
      headers: { "cache-control": "public, max-age=20, s-maxage=60" },
    })
  } catch {
    return NextResponse.json({ error: "Invalid Gecko JSON" }, { status: 502 })
  }
}