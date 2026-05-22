// src/lib/upstash-client.ts
// Upstash Redis singleton — rate limiting + coupon counters + token blacklist
// Used only in Route Handlers (server-side). Never imported from Client.

import { Redis } from '@upstash/redis';

// Singleton — Next.js re-uses module across requests in same worker
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL   ?? '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return _redis;
}

// ── Rate Limiter ──────────────────────────────────────────
// Returns true = allowed, false = blocked
// key: e.g. `rl:checkout:ip:1.2.3.4` or `rl:coupon:uid:abc`
export async function rateLimit(
  key:      string,
  max:      number,  // max hits
  windowSec: number, // window in seconds
): Promise<boolean> {
  const redis  = getRedis();
  const hits   = await redis.incr(key);
  if (hits === 1) await redis.expire(key, windowSec);
  return hits <= max;
}

// ── Token Blacklist ───────────────────────────────────────
// Marks a delivery token as used — expires after 1 hour
export async function blacklistToken(tokenHash: string): Promise<void> {
  await getRedis().set(`bl:token:${tokenHash}`, 1, { ex: 3600 });
}

export async function isTokenBlacklisted(tokenHash: string): Promise<boolean> {
  const val = await getRedis().get(`bl:token:${tokenHash}`);
  return val !== null;
}

// ── Coupon Usage Counter ──────────────────────────────────
// Atomic increment — returns new count
export async function incrCouponUsage(
  tenantId: string,
  code:     string,
): Promise<number> {
  const key = `coupon:${tenantId}:${code.toUpperCase()}`;
  return (await getRedis().incr(key)) as number;
}

export async function getCouponUsage(
  tenantId: string,
  code:     string,
): Promise<number> {
  const key = `coupon:${tenantId}:${code.toUpperCase()}`;
  return ((await getRedis().get(key)) as number) ?? 0;
}
