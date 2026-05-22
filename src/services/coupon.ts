// src/services/coupon.ts
// Sequential: Firestore read → Upstash counter check → compute discount
// No background workers. Called directly from checkout route handler.

import { getCoupon, incrementCouponUsage } from '@/services/firestore';
import { getCouponUsage }                  from '@/lib/upstash-client';
import { Err }                             from '@/lib/errors';
import type { Coupon }                     from '@/lib/types';

export interface CouponResult {
  coupon:     Coupon;
  discount:   number;   // ريال
  finalPrice: number;
}

// Validate + compute — does NOT increment yet (increment happens after payment)
export async function validateCoupon(
  tenantId:  string,
  code:      string,
  basePrice: number,
): Promise<CouponResult> {
  // 1. Firestore read
  const coupon = await getCoupon(tenantId, code);
  if (!coupon || !coupon.active) throw Err.coupon('الكوبون غير صحيح أو منتهي الصلاحية');

  // 2. Expiry check
  if (coupon.expiresAt && coupon.expiresAt.toMillis() < Date.now()) {
    throw Err.coupon('انتهت صلاحية هذا الكوبون');
  }

  // 3. Usage check — Upstash is source of truth (atomic, no race condition)
  if (coupon.maxUses !== null) {
    const used = await getCouponUsage(tenantId, code);
    if (used >= coupon.maxUses) throw Err.coupon('تم استنفاد هذا الكوبون');
  }

  // 4. Compute discount
  const discount = coupon.type === 'pct'
    ? Math.round(basePrice * coupon.value / 100)
    : Math.min(coupon.value, basePrice);

  return {
    coupon,
    discount,
    finalPrice: Math.max(0, basePrice - discount),
  };
}

// Called after successful Stripe payment — atomic increment in Upstash + Firestore
export async function applyCoupon(tenantId: string, code: string): Promise<void> {
  await Promise.all([
    incrCouponUsage(tenantId, code),        // Upstash (fast, atomic)
    incrementCouponUsage(tenantId, code),   // Firestore (for admin dashboard)
  ]);
}

// re-export for convenience
import { incrCouponUsage } from '@/lib/upstash-client';
