// src/app/api/coupon/route.ts
// POST /api/coupon
// Sequential: rate limit → parse → validate → respond
// Called from CheckoutForm before creating the order.

import { type NextRequest } from 'next/server';
import { parse, CouponSchema } from '@/lib/schemas';
import { Err, toResponse }     from '@/lib/errors';
import { rateLimit }           from '@/lib/upstash-client';
import { validateCoupon }      from '@/services/coupon';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // 1. Rate limit — 20 coupon checks per IP per minute
    const ip      = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await rateLimit(`rl:coupon:${ip}`, 20, 60);
    if (!allowed) throw Err.rateLimit();

    // 2. Parse + Zod
    const input = parse(CouponSchema, await req.json().catch(() => ({})));

    // 3. Validate coupon sequentially
    const result = await validateCoupon(input.tenantId, input.code, input.price);

    // 4. Return discount details (never expose coupon internal data)
    return Response.json({
      valid:      true,
      code:       input.code,
      discount:   result.discount,
      finalPrice: result.finalPrice,
      type:       result.coupon.type,
      value:      result.coupon.value,
      message:    `✅ خصم ${result.coupon.type === 'pct' ? result.coupon.value + '%' : result.coupon.value + ' ر.س'} — وفّرت ${result.discount} ر.س`,
    });

  } catch (err) {
    return toResponse(err);
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
