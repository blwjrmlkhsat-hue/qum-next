// src/app/api/stripe-webhook/route.ts
// POST /api/stripe-webhook
//
// Sequential execution — single function, no queues:
//   1. Verify Stripe signature (crypto)
//   2. Parse event + metadata
//   3. markOrderPaid (Firestore batch: order + user.purchasedBooks)
//   4. applyCoupon if present (Upstash + Firestore)
//   5. Generate delivery tokens
//   6. Send email with links
//   7. Write log

import { type NextRequest } from 'next/server';
import crypto               from 'crypto';

import { adminDb, FieldValue } from '@/lib/firebase-admin';
import { Err, toResponse }     from '@/lib/errors';
import { WebhookMetaSchema, parse } from '@/lib/schemas';
import { applyCoupon }         from '@/services/coupon';
import { writeLog }            from '@/services/firestore';

// Raw body needed for Stripe signature — disable body parsing
export const dynamic = 'force-dynamic';

// Book catalog (tenantId-agnostic for now — move to Firestore if multi-tenant)
const BOOK_CATALOG: Record<number, string> = {
  0: 'قُم — كتب علم النفس',
  1: 'قُم — كتب التفكير الإيجابي',
  2: 'قُم — كتب الصحة النفسية',
  3: 'قُم — كتب التحفيز والهمة',
  4: 'قُم — كتب بناء العادات',
  5: 'قُم — كتب العلاقات الإنسانية',
};

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // ── 1. Read raw body (required for Stripe signature) ──
    const rawBody = await req.text();
    const sig     = req.headers.get('stripe-signature') ?? '';
    const secret  = process.env.STRIPE_WEBHOOK_SECRET   ?? '';

    if (!verifyStripeSignature(rawBody, sig, secret)) {
      throw Err.webhook();
    }

    // ── 2. Parse event ────────────────────────────────────
    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw Err.input('Invalid JSON from Stripe');
    }

    // Only handle successful payments
    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'payment_intent.succeeded'
    ) {
      return Response.json({ received: true, skipped: event.type });
    }

    const session = event.data.object;

    // ── 3. Extract + validate metadata ────────────────────
    const meta = parse(WebhookMetaSchema, session['metadata'] ?? {});
    const { tenantId, uid, bookIds: rawBookIds } = meta;

    const bookIds: number[] = rawBookIds
      ? rawBookIds.split(',').map(Number).filter(n => !isNaN(n))
      : [];

    const email         = (session['customer_details'] as any)?.email
                       ?? (session['receipt_email'] as string)
                       ?? '';
    const name          = (session['customer_details'] as any)?.name
                       ?? 'عزيزي العميل';
    const stripeSession = (session['id'] as string) ?? '';
    const amount        = ((session['amount_total'] as number) ?? 0) / 100;
    const couponCode    = (session['metadata'] as any)?.couponCode ?? '';
    const orderId       = (session['metadata'] as any)?.orderId ?? '';
    const ip            = ''; // not available from Stripe

    console.log(`[webhook] ${event.type} | tenant:${tenantId} | uid:${uid} | books:${bookIds}`);

    // ── 4. Firestore: markOrderPaid + grantBookAccess ──────
    await markOrderPaid(tenantId, stripeSession, uid, bookIds, orderId, amount);

    // ── 5. Increment coupon usage ─────────────────────────
    if (couponCode) {
      await applyCoupon(tenantId, couponCode).catch(e =>
        console.warn('[webhook] coupon increment failed:', e.message)
      );
    }

    // ── 6. Generate delivery tokens + send email ──────────
    if (email && bookIds.length) {
      const baseUrl   = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://qum.sa';
      const dlSecret  = process.env.DELIVERY_SECRET      ?? '';
      const links     = bookIds
        .filter(id => BOOK_CATALOG[id] !== undefined)
        .map(id => ({
          title: BOOK_CATALOG[id],
          url:   `${baseUrl}/api/deliver?token=${generateDeliveryToken(id, email, orderId, dlSecret)}&tenantId=${tenantId}`,
        }));

      await sendDeliveryEmail(email, name, orderId, links).catch(e =>
        console.warn('[webhook] email send failed:', e.message)
      );
    }

    // ── 7. Log ────────────────────────────────────────────
    writeLog(tenantId, 'order.paid', uid || null, {
      orderId,
      bookIds: bookIds.join(','),
    }, ip);

    return Response.json({ received: true });

  } catch (err) {
    return toResponse(err);
  }
}

// ─────────────────────────────────────────────────────────
//  Firestore batch: update order + grant books to user
// ─────────────────────────────────────────────────────────
async function markOrderPaid(
  tenantId:      string,
  stripeSession: string,
  uid:           string,
  bookIds:       number[],
  orderId:       string,
  amount:        number,
): Promise<void> {
  const batch = adminDb.batch();

  // 1. Find pending order by Stripe session ID
  const ordersSnap = await adminDb
    .collection(`tenants/${tenantId}/orders`)
    .where('stripeSessionId', '==', stripeSession)
    .limit(1)
    .get();

  if (!ordersSnap.empty) {
    batch.update(ordersSnap.docs[0].ref, {
      status:  'paid',
      paidAt:  FieldValue.serverTimestamp(),
    });
  } else if (orderId) {
    // Fallback: use orderId from metadata if session ID not indexed yet
    const ref = adminDb.doc(`tenants/${tenantId}/orders/${orderId}`);
    batch.update(ref, {
      status:          'paid',
      stripeSessionId: stripeSession,
      paidAt:          FieldValue.serverTimestamp(),
    });
  }

  // 2. Grant book access to user
  if (uid && bookIds.length) {
    const userRef = adminDb.doc(`tenants/${tenantId}/users/${uid}`);
    batch.update(userRef, {
      purchasedBooks: FieldValue.arrayUnion(...bookIds),
      totalSpent:     FieldValue.increment(amount),
      ordersCount:    FieldValue.increment(1),
      updatedAt:      FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

// ─────────────────────────────────────────────────────────
//  Stripe signature verification
// ─────────────────────────────────────────────────────────
function verifyStripeSignature(
  payload: string,
  header:  string,
  secret:  string,
): boolean {
  if (!header || !secret) return false;
  try {
    const parts = header.split(',');
    const ts    = parts.find(p => p.startsWith('t='))?.slice(2) ?? '';
    const sigs  = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
    if (!ts || !sigs.length) return false;

    // Reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.${payload}`)
      .digest('hex');

    return sigs.some(sig => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(sig,      'hex'),
          Buffer.from(expected, 'hex'),
        );
      } catch { return false; }
    });
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────
//  Signed delivery token (5-minute TTL, single-use via Upstash)
// ─────────────────────────────────────────────────────────
function generateDeliveryToken(
  bookId:  number,
  email:   string,
  orderId: string,
  secret:  string,
): string {
  const payload = Buffer.from(JSON.stringify({
    bookId, email, orderId,
    exp: Math.floor(Date.now() / 1000) + 300,
    n:   crypto.randomBytes(6).toString('hex'),
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${sig}`;
}

// ─────────────────────────────────────────────────────────
//  Email via Resend (server-side, no EmailJS public key exposure)
// ─────────────────────────────────────────────────────────
async function sendDeliveryEmail(
  email:   string,
  name:    string,
  orderId: string,
  links:   Array<{ title: string; url: string }>,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const from   = process.env.EMAIL_FROM     ?? 'قُم <books@qum.sa>';
  if (!apiKey) { console.warn('[email] RESEND_API_KEY not set'); return; }

  const linksHtml = links
    .map(l => `
      <div style="margin:12px 0;padding:14px;background:#1A2235;border-radius:10px;border:1px solid rgba(59,130,246,.3);">
        <strong style="color:#60A5FA;display:block;margin-bottom:6px;">📚 ${l.title}</strong>
        <a href="${l.url}" style="color:#22C55E;font-size:13px;word-break:break-all;">
          📖 اقرأ الآن (الرابط صالح 5 دقائق)
        </a>
      </div>`)
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <body style="font-family:Cairo,Arial,sans-serif;background:#080C14;color:#E8EEF8;padding:32px;max-width:520px;margin:0 auto;">
      <h1 style="color:#fff;font-size:22px;margin-bottom:8px;">🎉 كتبك من قُم جاهزة!</h1>
      <p style="color:#6B7FA8;margin-bottom:24px;">السلام عليكم ${name}، شكراً لثقتك بقُم.</p>
      <p style="color:#E8EEF8;margin-bottom:16px;">طلبك رقم <strong>${orderId}</strong> تم بنجاح. إليك روابط القراءة:</p>
      ${linksHtml}
      <p style="color:#6B7FA8;font-size:12px;margin-top:24px;">
        ⚠️ الروابط صالحة لمدة 5 دقائق. افتح كل رابط فور استلامه.<br>
        مشكلة؟ تواصل معنا على واتساب.
      </p>
    </body>
    </html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to:      [email],
      subject: '🎉 كتبك من قُم جاهزة للقراءة!',
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[email] Resend error:', err);
    // Don't throw — email failure shouldn't fail the webhook
  } else {
    console.log(`[email] sent → ${email}`);
  }
}
