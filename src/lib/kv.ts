import { Redis } from '@upstash/redis'

// These must be present in `.env.local` (dev) and Vercel → Project → Environment Variables (prod)
export const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})