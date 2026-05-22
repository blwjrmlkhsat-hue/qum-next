// src/app/api/deliver/route.ts
// GET /api/deliver?token=xxx&tenantId=xxx
// Sequential: parse -> verify token -> Upstash blacklist ->
//             Firestore access check -> Cloudinary fetch -> stream PDF

import { type NextRequest } from 'next/server';
import crypto               from 'crypto';

import { parse, DeliverQuerySchema } from '@/lib/schemas';
import { Err, toResponse }           from '@/lib/errors';
import { isTokenBlacklisted, blacklistToken } from '@/lib/upstash-client';
import { adminDb }                   from '@/lib/firebase-admin';

const BOOK_CATALOG: Record<number, { file: string; title: string }> = {
  0: { file: 'qum/books/elm-alnafs.pdf',         title: 'كتب علم النفس' },
  1: { file: 'qum/books/altafkeer-aliijabi.pdf',  title: 'كتب التفكير الإيجابي' },
  2: { file: 'qum/books/alsiha-alnafsia.pdf',     title: 'كتب الصحة النفسية' },
  3: { file: 'qum/books/altahfiz.pdf',            title: 'كتب التحفيز والهمة' },
  4: { file: 'qum/books/aleadat.pdf',             title: 'كتب بناء العادات' },
  5: { file: 'qum/books/alealaqat.pdf',           title: 'كتب العلاقات الإنسانية' },
};

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    // 1. Parse query params
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const { token, tenantId } = parse(DeliverQuerySchema, params);

    // 2. Verify HMAC signature + expiry
    const secret  = process.env.DELIVERY_SECRET ?? '';
    const payload = verifyDeliveryToken(token, secret);
    if (!payload) return htmlError('انتهت صلاحية رابط القراءة', 'الرابط صالح 5 دقائق فقط.');

    // 3. Upstash: single-use check
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (await isTokenBlacklisted(tokenHash)) {
      return htmlError('تم استخدام هذا الرابط', 'كل رابط صالح مرة واحدة فقط.');
    }

    // 4. Firestore: verify user still owns the book
    const { bookId, uid } = payload;
    if (uid) {
      const snap  = await adminDb.doc(`tenants/${tenantId}/users/${uid}`).get();
      const owned = snap.exists ? ((snap.data()?.purchasedBooks ?? []) as number[]) : [];
      if (!owned.includes(bookId)) throw Err.forbidden('ليس لديك صلاحية قراءة هذا الكتاب');
    }

    // 5. Resolve book
    const book = BOOK_CATALOG[bookId];
    if (!book) throw Err.notFound('الكتاب');

    // 6. Cloudinary signed URL (60s TTL)
    const cloudUrl = buildCloudinarySignedUrl(book.file);
    if (!cloudUrl) throw Err.system('Cloudinary not configured');

    // 7. Fetch PDF
    let pdfBuffer: ArrayBuffer;
    try {
      const r = await fetch(cloudUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Cloudinary ${r.status}`);
      pdfBuffer = await r.arrayBuffer();
    } catch (e) {
      throw Err.system(e);
    }

    // 8. Blacklist token (single-use enforced)
    await blacklistToken(tokenHash);

    // 9. Stream — filename hides original Cloudinary path
    const safeName = `qum-${book.title.replace(/\s+/g, '-')}.pdf`;
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type':           'application/pdf',
        'Content-Disposition':    `inline; filename="${encodeURIComponent(safeName)}"`,
        'Content-Length':         String(pdfBuffer.byteLength),
        'Cache-Control':          'no-store, no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag':           'noindex',
      },
    });

  } catch (err) {
    return toResponse(err);
  }
}

// Token verify
interface DeliveryPayload { bookId: number; email: string; orderId: string; uid?: string; exp: number; }

function verifyDeliveryToken(token: string, secret: string): DeliveryPayload | null {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const p: DeliveryPayload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

// Cloudinary signed URL
function buildCloudinarySignedUrl(filePath: string): string {
  const cloud  = process.env.CLOUDINARY_CLOUD  ?? '';
  const key    = process.env.CLOUDINARY_KEY    ?? '';
  const secret = process.env.CLOUDINARY_SECRET ?? '';
  if (!cloud || !key || !secret) return '';
  const ts  = Math.floor(Date.now() / 1000) + 60;
  const sig = crypto.createHash('sha1').update(`public_id=${filePath}&timestamp=${ts}${secret}`).digest('hex');
  return `https://res.cloudinary.com/${cloud}/raw/upload?public_id=${encodeURIComponent(filePath)}&timestamp=${ts}&api_key=${key}&signature=${sig}`;
}

// Browser-friendly error page
function htmlError(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="font-family:Cairo,Arial,sans-serif;text-align:center;padding:4rem;background:#080C14;color:#E8EEF8;">
    <h2 style="color:#EF4444;">${title}</h2><p style="color:#6B7FA8;">${body}</p>
    <a href="/" style="color:#60A5FA;">← العودة للموقع</a></body></html>`,
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
