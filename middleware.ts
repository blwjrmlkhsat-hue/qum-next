// middleware.ts  (root — Edge Runtime)
//
// Defense layers in order:
//   1. ESNS hash     — privacy-safe ephemeral fingerprint (no raw IP stored)
//   2. Token Bucket  — fair rate limiting via Upstash Redis (Lua atomic)
//   3. Route guard   — /library, /checkout require auth; /admin requires isAdmin
//   4. CSP nonce     — injected into every HTML response
//
// Token Bucket params:
//   capacity  = 30 tokens  (burst allowance)
//   refill    = 10 tokens / 10 seconds
//   cost      = 1 token (normal) | 2 (auth/coupon) | 3 (checkout POST)
//   exhausted = HTTP 429 + Retry-After

import { NextRequest, NextResponse } from 'next/server';
import { Redis }                     from '@upstash/redis/edge';
import crypto                        from 'node:crypto';

// ── Bucket config ─────────────────────────────────────────
const CAPACITY   = 30;
const REFILL     = 10;
const WINDOW_MS  = 10_000;
const BUCKET_TTL = 3600;   // Redis key TTL (seconds)

// Per-route token cost
const COSTS: Array<{ path: RegExp; method?: string; cost: number }> = [
  { path: /^\/api\/v1\/checkout$/,   method: 'POST', cost: 3 },
  { path: /^\/api\/coupon$/,         method: 'POST', cost: 2 },
  { path: /^\/api\/auth\/session$/,  method: 'POST', cost: 2 },
  { path: /^\/api\/deliver$/,        method: 'GET',  cost: 2 },
  { path: /^\/api\//,                                cost: 1 },
  { path: /^\//,                                     cost: 1 },
];

// Static assets — skip entirely
const EXEMPT = /^\/_next\/|^\/favicon|^\/robots|^\/sitemap|\.(?:svg|png|jpg|jpeg|webp|ico|css|js\.map)$/;

// Protected routes
const PROTECTED  = ['/library', '/checkout'];
const ADMIN_ONLY = ['/admin'];

// ── Redis singleton ───────────────────────────────────────
let _redis: Redis | null = null;
function getRedis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL   ?? '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return _redis;
}

// ═════════════════════════════════════════════════════════
//  ENTRY POINT
// ═════════════════════════════════════════════════════════
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (EXEMPT.test(pathname)) return NextResponse.next();

  // 1. Build ESNS — privacy-safe fingerprint
  const esns = buildESNS(req);

  // 2. Token Bucket
  const cost    = routeCost(pathname, req.method);
  const allowed = await consumeTokens(esns, cost);
  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'طلبات كثيرة — انتظر قليلاً', code: 'rate_limited' }),
      {
        status: 429,
        headers: {
          'Content-Type':      'application/json',
          'Retry-After':       String(Math.ceil(WINDOW_MS / 1000)),
          'X-RateLimit-Limit': String(CAPACITY),
        },
      },
    );
  }

  // 3. Route protection
  const needsAuth  = PROTECTED.some(r  => pathname.startsWith(r));
  const needsAdmin = ADMIN_ONLY.some(r => pathname.startsWith(r));

  if (needsAuth || needsAdmin) {
    const session = req.cookies.get('qum_session')?.value;
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    if (needsAdmin && !(await verifyAdminClaim(session))) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // 4. Build response with CSP nonce + security headers
  const nonce = generateNonce();
  const res   = NextResponse.next();

  res.headers.set('x-nonce', nonce);          // read by layout.tsx RSC
  res.headers.set('x-esns',  esns);           // available to Route Handlers (no raw IP)
  applySecurityHeaders(res, nonce);

  return res;
}

// ═════════════════════════════════════════════════════════
//  ESNS — Ephemeral Session Network Signature
//
//  Design goals:
//    * No raw IP ever stored in Redis or logs
//    * Cannot be reversed to identify an individual
//    * Rotates every hour — old buckets expire naturally in Redis
//    * Subnet masking groups shared NAT users (fair for offices/ISPs)
//    * ESNS_SECRET env isolates hashes per deployment domain
//
//  Inputs:
//    subnet      /24 (IPv4) or /48 (IPv6) — drops individual host octet
//    user-agent  browser/bot signal — major differentiator
//    accept-lang locale signal — secondary differentiator
//    hourBucket  Math.floor(Date.now() / 3_600_000) — rotates hourly
//    ESNS_SECRET deployment-specific salt
// ═════════════════════════════════════════════════════════
function buildESNS(req: NextRequest): string {
  const rawIp  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
              ?? req.headers.get('x-real-ip')
              ?? 'unknown';

  const subnet  = maskToSubnet(rawIp);
  const ua      = req.headers.get('user-agent')      ?? '';
  const lang    = req.headers.get('accept-language') ?? '';
  const hour    = Math.floor(Date.now() / 3_600_000);
  const secret  = process.env.ESNS_SECRET ?? 'qum-esns-v1';

  return crypto
    .createHash('sha256')
    .update(`${subnet}|${ua}|${lang}|${hour}|${secret}`)
    .digest('hex')
    .slice(0, 32);          // 128 bits — enough for bucketing
}

function maskToSubnet(ip: string): string {
  if (ip.includes(':')) {
    // IPv6 /48 — keep first 3 groups
    return ip.split(':').slice(0, 3).join(':');
  }
  // IPv4 /24 — zero last octet
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : ip;
}

// ═════════════════════════════════════════════════════════
//  TOKEN BUCKET  (Lua atomic — single Redis round-trip)
//
//  Redis Hash per ESNS:
//    tokens   float  current available tokens
//    last_ms  int    timestamp of last refill
//
//  Algorithm:
//    elapsed  = now - last_ms
//    gained   = (elapsed / WINDOW_MS) * REFILL_RATE
//    tokens   = min(CAPACITY, tokens + gained)
//    if tokens >= cost: tokens -= cost → allow
//    else              → deny (state still updated for next refill calc)
// ═════════════════════════════════════════════════════════
const LUA = `
local key     = KEYS[1]
local cap     = tonumber(ARGV[1])
local refill  = tonumber(ARGV[2])
local win     = tonumber(ARGV[3])
local cost    = tonumber(ARGV[4])
local now     = tonumber(ARGV[5])
local ttl     = tonumber(ARGV[6])
local s       = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens  = tonumber(s[1]) or cap
local last    = tonumber(s[2]) or now
local elapsed = math.max(0, now - last)
local gained  = (elapsed / win) * refill
tokens        = math.min(cap, tokens + gained)
local ok      = 0
if tokens >= cost then tokens = tokens - cost; ok = 1 end
redis.call('HSET', key, 'tokens', tokens, 'last_ms', now)
redis.call('EXPIRE', key, ttl)
return ok
`.trim();

async function consumeTokens(esns: string, cost: number): Promise<boolean> {
  if (!process.env.UPSTASH_REDIS_REST_URL) return true; // dev: skip
  try {
    const result = await getRedis().eval(
      LUA,
      [`tb:${esns}`],
      [CAPACITY, REFILL, WINDOW_MS, cost, Date.now(), BUCKET_TTL],
    ) as number;
    return result === 1;
  } catch {
    return true; // fail open — don't block on Redis downtime
  }
}

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
function routeCost(pathname: string, method: string): number {
  for (const r of COSTS) {
    if (!r.path.test(pathname)) continue;
    if (r.method && r.method !== method) continue;
    return r.cost;
  }
  return 1;
}

function generateNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64');
}

function applySecurityHeaders(res: NextResponse, nonce: string): void {
  const h = res.headers;
  h.set('X-Frame-Options',           'DENY');
  h.set('X-Content-Type-Options',    'nosniff');
  h.set('Referrer-Policy',           'strict-origin-when-cross-origin');
  h.set('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Content-Security-Policy', [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://www.gstatic.com https://apis.google.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src https://fonts.gstatic.com`,
    `connect-src 'self' https://*.googleapis.com https://firestore.googleapis.com https://api.stripe.com`,
    `frame-src https://js.stripe.com https://buy.stripe.com`,
    `img-src 'self' data: blob: https:`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ].join('; '));
}

async function verifyAdminClaim(idToken: string): Promise<boolean> {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '';
  if (!key) return false;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) },
    );
    if (!r.ok) return false;
    const d = await r.json();
    const u = d.users?.[0];
    return u?.customAttributes ? JSON.parse(u.customAttributes)?.isAdmin === true : false;
  } catch { return false; }
}

// ── Matcher ───────────────────────────────────────────────
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
