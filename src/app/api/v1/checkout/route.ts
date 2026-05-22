// src/app/api/v1/checkout/route.ts
// POST /api/v1/checkout
//
// Sequential execution — no queues, no background workers:
//   1. Parse + Zod validate
//   2. Rate limit (Upstash)
//   3. Auth check (optional — guests allowed)
//   4. Load + validate products from Firestore
//   5. Validate coupon (if provided)
//   6. Create order in Firestore (status: pending)
//   7. Resolve Stripe Payment Link
//   8. Return { checkoutUrl, orderId, total }
//
// Stripe Webhook completes the flow after payment:
//   stripe-webhook → markOrderPaid → grantBookAccess → sendEmail

import { type NextRequest } from 'next/server';
import { z }                from 'zod';
import { cookies }          from 'next/headers';

import { parse, CheckoutSchema, type CheckoutInput } from '@/lib/schemas';
import { Err, toResponse }                           from '@/lib/errors';
import { rateLimit }                                 from '@/lib/upstash-client';
import { getServerSession }                          from '@/lib/session';
import {
  getProduct,
  createOrder,
}                                                    from '@/services/firestore';
import { validateCoupon }                            from '@/services/coupon';
import { writeLog }                                  from '@/services/firestore';
import type { Order, Product }                       from '@/lib/types';

// ── Response shape ────────────────────────────────────────
interface CheckoutResponse {
  orderId:     string;
  checkoutUrl: string;   // Stripe Payment Link to redirect client
  subtotal:    number;
  discount:    number;
  total:       number;
  couponCode:  string | null;
}

// ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<Response> {
  try {
    // ── 1. Parse body + Zod ──────────────────────────────
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw Err.input('Request body must be valid JSON');
    }

    const input: CheckoutInput = parse(CheckoutSchema, raw);
    const { tenantId, uid, name, email, phone, productIds, couponCode, method } = input;

    // ── 2. Rate limit — 10 checkout attempts per IP per minute ──
    const ip      = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await rateLimit(`rl:checkout:${tenantId}:${ip}`, 10, 60);
    if (!allowed) throw Err.rateLimit();

    // ── 3. Auth (optional for checkout — guests can buy) ──
    // If uid provided, verify session matches
    let verifiedUid = '';
    if (uid) {
      const idToken = cookies().get('qum_session')?.value ?? '';
      const session = idToken ? await getServerSession(idToken) : null;
      if (!session || session.uid !== uid) {
        throw Err.deny('Session mismatch — re-login and try again');
      }
      verifiedUid = session.uid;
    }

    // ── 4. Load products from Firestore ──────────────────
    const productResults = await Promise.all(
      productIds.map(pid => getProduct(tenantId, pid))
    );

    // All products must exist and be active
    const products: Product[] = [];
    for (let i = 0; i < productIds.length; i++) {
      const p = productResults[i];
      if (!p)         throw Err.notFound(`المنتج ${productIds[i]}`);
      if (!p.active)  throw Err.notFound(`المنتج ${p.title} غير متاح`);
      products.push(p);
    }

    // Collect all book IDs (expand packages)
    const bookIds = Array.from(new Set(
      products.flatMap(p =>
        p.type === 'package'
          ? p.includesIds.map(Number)
          : [Number(p.productId.replace(/\D/g, ''))]
      )
    ));

    // ── 5. Subtotal ───────────────────────────────────────
    const subtotal = products.reduce((sum, p) => sum + p.price, 0);

    // ── 6. Coupon (if provided) ───────────────────────────
    let discount   = 0;
    let finalTotal = subtotal;
    let resolvedCoupon: string | null = null;

    if (couponCode) {
      const result  = await validateCoupon(tenantId, couponCode, subtotal);
      discount      = result.discount;
      finalTotal    = result.finalPrice;
      resolvedCoupon = couponCode;
    }

    // ── 7. Resolve Stripe Payment Link ────────────────────
    // Use product-specific link for single product,
    // tenant default link for packages or multi-product carts.
    const stripeLink =
      products.length === 1 && products[0].stripeLink
        ? products[0].stripeLink
        : await getTenantStripeLink(tenantId);

    if (!stripeLink) {
      throw Err.system('Stripe Payment Link not configured for this tenant');
    }

    // ── 8. Create order in Firestore (status: pending) ───
    const orderId = await createOrder(tenantId, {
      orderId:         '',                    // will be Firestore doc ID
      tenantId,
      uid:             verifiedUid,
      email,
      name,
      phone:           phone ?? '',
      productIds,
      bookIds,
      couponCode:      resolvedCoupon,
      subtotal,
      discount,
      total:           finalTotal,
      currency:        'SAR',
      stripeSessionId: '',                    // filled by webhook after payment
      status:          'pending',
      paidAt:          null,
    } as 'createdAt' | 'paidAt'>);

    // ── 9. Fire-and-forget log ────────────────────────────
    writeLog(tenantId, 'order.created', verifiedUid || null, {
      orderId,
      total:  finalTotal,
      method,
    }, ip);

    // ── 10. Return checkout URL ───────────────────────────
    const body: CheckoutResponse = {
      orderId,
      checkoutUrl: stripeLink,
      subtotal,
      discount,
      total: finalTotal,
      couponCode: resolvedCoupon,
    };

    return Response.json(body, { status: 201 });

  } catch (err) {
    return toResponse(err);
  }
}

// ── helper: get tenant default Stripe link from Firestore ─
async function getTenantStripeLink(tenantId: string): Promise<string> {
  const { adminDb } = await import('@/lib/firebase-admin');
  try {
    const snap = await adminDb.doc(`tenants/${tenantId}`).get();
    return snap.exists ? (snap.data()?.stripeLink ?? '') : '';
  } catch (e) {
    throw Err.system(e);
  }
}

// ── OPTIONS for CORS preflight ────────────────────────────
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  process.env.NEXT_PUBLIC_SITE_URL ?? '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
