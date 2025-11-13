// src/app/api/test-kv/route.ts
import { kvGet, kvSet, redis } from '@/lib/kv'

export async function GET() {
  try {
    const key = 'hemi:test:' + Date.now()

    // write a test value with 60s TTL
    await kvSet(key, { hello: 'world', at: Date.now() }, 60)

    // ✅ give the generic an explicit type instead of typeof value
    const value = await kvGet<{ hello: string; at: number }>(key)

    const pong = await redis.ping()

    return new Response(
      JSON.stringify({ ok: true, pong, key, value }),
      { headers: { 'content-type': 'application/json' } },
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || 'kv test failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }
}