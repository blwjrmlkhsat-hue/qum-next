// src/app/api/livekit/token/route.ts
// POST /api/livekit/token
//
// Sequential: rate limit → auth verify → Firestore access check →
//             sign LiveKit JWT → return connection credentials
//
// ENV required:
//   LIVEKIT_API_KEY     pk_xxx
//   LIVEKIT_API_SECRET  sk_xxx
//   LIVEKIT_URL         wss://your-project.livekit.cloud

import { type NextRequest } from 'next/server';
import crypto               from 'node:crypto';
import { cookies }          from 'next/headers';
import { z }                from 'zod';
import { Err, toResponse }  from '@/lib/errors';
import { rateLimit }        from '@/lib/upstash-client';
import { getServerSession } from '@/lib/session';
import { adminDb }          from '@/lib/firebase-admin';
import { parse }            from '@/lib/schemas';

// ── Request schema ────────────────────────────────────────
const TokenSchema = z.object({
  tenantId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  roomId:   z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  roomType: z.enum(['community', 'session', 'mentor']).default('community'),
});

// Room TTL per type (seconds)
const ROOM_TTL: Record<string, number> = {
  community: 4 * 3600,
  session:   2 * 3600,
  mentor:    1 * 3600,
};

// ═════════════════════════════════════════════════════════
export async function POST(req: NextRequest): Promise<Response> {
  try {
    // 1. Rate limit — 20 requests per IP per 5 minutes
    const ip      = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await rateLimit(`rl:livekit:${ip}`, 20, 300);
    if (!allowed) throw Err.rateLimit();

    // 2. Auth — always required for LiveKit tokens
    const idToken = cookies().get('qum_session')?.value ?? '';
    if (!idToken) throw Err.deny('يجب تسجيل الدخول للانضمام للغرفة');

    const session = await getServerSession(idToken);
    if (!session) throw Err.deny('الجلسة منتهية — سجّل دخولك مجدداً');

    // 3. Parse body
    const body = parse(TokenSchema, await req.json().catch(() => ({})));
    const { tenantId, roomId, roomType } = body;

    // 4. Firestore: verify user belongs to tenant
    const userSnap = await adminDb
      .doc(`tenants/${tenantId}/users/${session.uid}`)
      .get()
      .catch(() => null);

    if (!userSnap?.exists) throw Err.forbidden('لست عضواً في هذا المجتمع');

    const profile   = userSnap.data()!;
    const booksRead = ((profile.purchasedBooks ?? []) as unknown[]).length;
    const level     = deriveLevel(booksRead);

    // 5. Room access control per type
    if (roomType === 'mentor' && level !== 'mentor') {
      throw Err.forbidden('غرفة المرشدين تتطلب قراءة 10 كتب أو أكثر');
    }
    if (roomType === 'session' && booksRead < 1) {
      throw Err.forbidden('يجب شراء كتاب واحد على الأقل');
    }

    // 6. Scoped room name prevents cross-tenant collisions
    const roomName = `${tenantId}__${roomType}__${roomId}`;
    const identity = `${session.uid}__${level}`;
    const ttl      = ROOM_TTL[roomType] ?? 3600;

    // 7. Validate LiveKit env
    const apiKey     = process.env.LIVEKIT_API_KEY    ?? '';
    const apiSecret  = process.env.LIVEKIT_API_SECRET ?? '';
    const livekitUrl = process.env.LIVEKIT_URL        ?? '';
    if (!apiKey || !apiSecret || !livekitUrl) throw Err.system('LiveKit credentials not configured');

    // 8. Sign JWT
    const token = buildLiveKitToken({
      apiKey, apiSecret, roomName, identity,
      name:         profile.name ?? session.name,
      ttl,
      canPublish:   true,
      canSubscribe: true,
      metadata: JSON.stringify({ level, booksRead, tenantId }),
    });

    // 9. Fire-and-forget log
    adminDb.collection(`tenants/${tenantId}/logs`).add({
      tenantId, uid: session.uid,
      event: 'livekit.token_issued',
      meta: { roomName, roomType, level: String(level) },
      ip, createdAt: new Date(),
    }).catch(() => {});

    return Response.json(
      { token, url: livekitUrl, roomName, identity, level, expiresIn: ttl },
      { headers: { 'Cache-Control': 'no-store' } },
    );

  } catch (err) {
    return toResponse(err);
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}

// ═════════════════════════════════════════════════════════
//  buildLiveKitToken — HMAC-SHA256 signed JWT (no SDK)
//
//  Spec: https://docs.livekit.io/reference/server-apis/
//  Header: { alg: "HS256", typ: "JWT" }
//  Claims: iss, sub, exp, nbf, jti, name, metadata, video{}
// ═════════════════════════════════════════════════════════
interface TokenOpts {
  apiKey:       string;
  apiSecret:    string;
  roomName:     string;
  identity:     string;
  name:         string;
  ttl:          number;
  canPublish:   boolean;
  canSubscribe: boolean;
  metadata?:    string;
}

function buildLiveKitToken(o: TokenOpts): string {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:      o.apiKey,
    sub:      o.identity,
    exp:      now + o.ttl,
    nbf:      now,
    jti:      crypto.randomUUID(),
    name:     o.name,
    metadata: o.metadata ?? '',
    video: {
      room:           o.roomName,
      roomJoin:       true,
      canPublish:     o.canPublish,
      canSubscribe:   o.canSubscribe,
      canPublishData: true,  // text data channel
      hidden:         false,
      recorder:       false,
    },
  }));

  const sig = crypto
    .createHmac('sha256', o.apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

function b64url(str: string): string {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function deriveLevel(n: number): string {
  if (n >= 10) return 'mentor';
  if (n >= 5)  return 'scholar';
  if (n >= 2)  return 'reader';
  return 'starter';
}
