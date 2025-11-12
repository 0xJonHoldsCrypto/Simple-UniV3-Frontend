import { kvGet, kvSet, redis } from '@/lib/kv'

export const runtime = 'edge'

export async function GET() {
  try {
    const key = 'hemi:test:' + Date.now()
    await kvSet(key, { hello: 'world', at: Date.now() }, 60)
    const value = await kvGet<typeof value>(key) // or <any>
    const pong = await redis.ping()
    return new Response(JSON.stringify({ ok: true, pong, key, value }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}