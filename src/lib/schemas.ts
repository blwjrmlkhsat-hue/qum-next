// src/lib/schemas.ts
// Zod schemas — single source of truth for all incoming request bodies
// Route Handlers parse with these, then pass typed data to services.

import { z } from 'zod';

// ── reusable field validators ─────────────────────────────
const saEmail  = z.string().email('بريد إلكتروني غير صحيح').max(254);
const saName   = z.string().min(2, 'الاسم حرفان على الأقل').max(80).regex(/^[\u0600-\u06FFa-zA-Z\s.'-]+$/, 'الاسم يحتوي على رموز غير مسموحة');
const saPhone  = z.string().regex(/^\+?[0-9\s\-()]{7,20}$/, 'رقم جوال غير صحيح').optional();
const saTenant = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'tenantId غير صالح');
const saPrice  = z.number().nonnegative().max(100_000);
const saCode   = z.string().min(3).max(20).regex(/^[A-Z0-9]+$/).transform(s => s.toUpperCase());

// ── Checkout ──────────────────────────────────────────────
export const CheckoutSchema = z.object({
  tenantId:   saTenant,
  uid:        z.string().min(1).max(128).optional(),   // فارغ إذا guest
  name:       saName,
  email:      saEmail,
  phone:      saPhone,
  productIds: z.array(z.string().min(1).max(64)).min(1, 'اختر منتجاً واحداً على الأقل').max(20),
  couponCode: saCode.optional(),
  method:     z.enum(['visa', 'mastercard']).default('visa'),
});
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

// ── Coupon validate ───────────────────────────────────────
export const CouponSchema = z.object({
  tenantId: saTenant,
  code:     saCode,
  price:    saPrice,
});
export type CouponInput = z.infer<typeof CouponSchema>;

// ── Stripe Webhook (raw body — no Zod, verified by signature) ──
// Parsed after crypto verify — schema only for metadata fields
export const WebhookMetaSchema = z.object({
  tenantId: saTenant,
  uid:      z.string().max(128).default(''),
  bookIds:  z.string().default(''),          // comma-separated numbers
});

// ── Admin: update product ─────────────────────────────────
export const UpdateProductSchema = z.object({
  tenantId:  saTenant,
  productId: z.string().min(1).max(64),
  data: z.object({
    title:       z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    price:       saPrice.optional(),
    oldPrice:    saPrice.nullable().optional(),
    active:      z.boolean().optional(),
    sortOrder:   z.number().int().nonnegative().optional(),
    stripeLink:  z.string().url('رابط Stripe غير صحيح').optional(),
    pdfPath:     z.string().max(500).optional(),
  }),
});

// ── Auth: register / login ────────────────────────────────
export const RegisterSchema = z.object({
  tenantId: saTenant,
  name:     saName,
  email:    saEmail,
  password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(72),
});

export const LoginSchema = z.object({
  tenantId: saTenant,
  email:    saEmail,
  password: z.string().min(1).max(72),
});

// ── Deliver token ─────────────────────────────────────────
export const DeliverQuerySchema = z.object({
  token:    z.string().min(10).max(512),
  tenantId: saTenant,
});

// ── Zod parse helper — throws ApiError on failure ─────────
import { Err } from '@/lib/errors';

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw Err.input(first?.message ?? 'بيانات غير صحيحة', result.error.flatten());
  }
  return result.data;
}
