// src/app/api/auth/session/route.ts
// POST  -> verify Firebase ID token -> set httpOnly session cookie
// DELETE -> clear cookie on logout
// Sequential: rate limit -> verify -> set cookie -> respond

import { type NextRequest } from 'next/server';
import { cookies }          from 'next/headers';
import { Err, toResponse }  from '@/lib/errors';
import { verifyIdToken }    from '@/services/auth';
import { rateLimit }        from '@/lib/upstash-client';

const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ip      = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await rateLimit(`rl:session:${ip}`, 15, 60);
    if (!allowed) throw Err.rateLimit();

    const body = await req.json().catch(() => ({}));
    const { idToken } = body;
    if (!idToken || typeof idToken !== 'string') throw Err.missing('idToken');

    // Verify with Firebase Admin (checks revocation too)
    const uid = await verifyIdToken(idToken);

    // httpOnly session cookie — never readable from JS
    cookies().set('qum_session', idToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   SESSION_MAX_AGE,
      path:     '/',
    });

    return Response.json({ uid, ok: true });

  } catch (err) {
    return toResponse(err);
  }
}

export async function DELETE(): Promise<Response> {
  cookies().delete('qum_session');
  return Response.json({ ok: true });
}
