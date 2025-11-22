// src/lib/kv.ts
import { Redis } from "@upstash/redis";

// Support either Upstash defaults or Vercel KV-style names
const URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;

const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

if (!URL || !TOKEN) {
  // Fail fast with a clear message (helps when testing locally)
  throw new Error(
    "KV not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)"
  );
}

// Single shared client (Edge-safe)
export const redis = new Redis({ url: URL, token: TOKEN });

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number) {
  if (ttlSeconds && ttlSeconds > 0) {
    // ex = TTL seconds
    await redis.set(key, value as any, { ex: ttlSeconds });
  } else {
    await redis.set(key, value as any);
  }
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const v = await redis.get<T | null>(key);
  return (v ?? null) as T | null;
}
