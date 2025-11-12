import { kv } from '@/lib/kv'

export const runtime = 'edge' // optional; works with Upstash nicely

export async function GET() {
  try {
    const key = 'hemi:test:' + new Date().toISOString()

    // write
    await kv.set(key, { hello: 'world', at: Date.now() }, { ex: 60 })

    // read
    const value = await kv.get<typeof Object>(key)

    // ping (SDK emulates with a request)
    const pong = await kv.ping()

    return new Response(
      JSON.stringify({ ok: true, pong, key, value }),
      { headers: { 'content-type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }
}