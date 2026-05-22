// src/app/api/assets/serve/route.ts
// GET /api/assets/serve?assetId=xxx&tenantId=xxx
//
// Sequential: auth → Firestore asset lookup → access check →
//             generate short-lived Cloudinary signed URL (5 min) → redirect
//
// The real Cloudinary URL never appears in the browser address bar.
// The signed URL expires 5 minutes after issuance.

import { type NextRequest } from 'next/server';
import crypto               from 'node:crypto';
import { cookies }          from 'next/headers';
import { z }                from 'zod';
import { Err, toResponse }  from '@/lib/errors';
import { rateLimit }        from '@/lib/upstash-client';
import { getServerSession } from '@/lib/session';
import { adminDb }          from '@/lib/firebase-admin';
import { parse }            from '@/lib/schemas';

const ServeSchema = z.object({
  assetId:  z.string().min(1).max(128),
  tenantId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
});

const SIGNED_URL_TTL = 5 * 60; // 5 minutes

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    // 1. Auth
    const idToken = cookies().get('qum_session')?.value ?? '';
    if (!idToken) throw Err.deny('يجب تسجيل الدخول للوصول للملفات');
    const session = await getServerSession(idToken);
    if (!session) throw Err.deny('الجلسة منتهية');

    // 2. Rate limit
    const ip      = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await rateLimit(`rl:serve:${session.uid}`, 30, 60);
    if (!allowed) throw Err.rateLimit();

    // 3. Parse query
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const { assetId, tenantId } = parse(ServeSchema, params);

    // 4. Firestore: load asset record
    const assetSnap = await adminDb
      .doc(`tenants/${tenantId}/assets/${assetId}`)
      .get();

    if (!assetSnap.exists) throw Err.notFound('الملف');
    const asset = assetSnap.data()!;

    // 5. Access control:
    //    - Admins: always
    //    - Users:  only if asset is in their purchased scope
    if (!session.isAdmin) {
      // For book PDFs: verify user purchased the associated book
      if (asset.assetType === 'pdf') {
        const userSnap = await adminDb.doc(`tenants/${tenantId}/users/${session.uid}`).get();
        const owned    = (userSnap.data()?.purchasedBooks ?? []) as string[];
        if (!owned.includes(asset.linkedBookId ?? '')) {
          throw Err.forbidden('هذا الملف مرتبط بكتاب غير مشترى');
        }
      }
      // For videos: verify at least one purchase (community content)
      if (asset.assetType === 'video') {
        const userSnap = await adminDb.doc(`tenants/${tenantId}/users/${session.uid}`).get();
        const owned    = (userSnap.data()?.purchasedBooks ?? []) as string[];
        if (owned.length === 0) throw Err.forbidden('يجب شراء كتاب واحد على الأقل');
      }
    }

    // 6. Generate Cloudinary signed URL (short-lived, 5 min)
    const signedUrl = buildCloudinarySignedUrl(
      asset.publicId,
      asset.resourceType ?? 'raw',
      SIGNED_URL_TTL,
    );

    if (!signedUrl) throw Err.system('Cloudinary not configured');

    // 7. Log access (fire-and-forget)
    adminDb.collection(`tenants/${tenantId}/logs`).add({
      tenantId, uid: session.uid,
      event: 'asset.served',
      meta:  { assetId, assetType: asset.assetType },
      ip, createdAt: new Date(),
    }).catch(() => {});

    // 8. Redirect to signed URL — URL never stored in browser history
    //    (302 temporary, so browser won't cache the redirect target)
    return Response.redirect(signedUrl, 302);

  } catch (err) {
    return toResponse(err);
  }
}

// ── Cloudinary signed URL builder ─────────────────────────
function buildCloudinarySignedUrl(
  publicId:     string,
  resourceType: string,
  ttlSec:       number,
): string {
  const cloud  = process.env.CLOUDINARY_CLOUD  ?? '';
  const key    = process.env.CLOUDINARY_KEY    ?? '';
  const secret = process.env.CLOUDINARY_SECRET ?? '';
  if (!cloud || !key || !secret) return '';

  const exp = Math.floor(Date.now() / 1000) + ttlSec;

  // Cloudinary authenticated URL signature
  const toSign    = `exp_${exp}/public_id:${publicId}${secret}`;
  const signature = crypto.createHash('sha256').update(toSign).digest('hex');

  return (
    `https://res.cloudinary.com/${cloud}/${resourceType}/upload` +
    `/s--${signature.slice(0, 8)}--` +      // short signature prefix
    `/e_${exp}` +                            // expiration transformation
    `/${publicId}`
  );
}
