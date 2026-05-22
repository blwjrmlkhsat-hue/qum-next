'use client';
// src/hooks/useCheckout.ts
// TanStack Query hook — wires PricingBlock directly to /api/v1/checkout
// and /api/coupon. Backend URL, headers, error mapping all hidden here.
// Components receive clean typed state — no fetch logic leaks through.

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { useQum }                from '@/components/Providers';
import type { Product }          from '@/lib/types';

// ── Public shapes (components see only these) ─────────────
export interface PricingProduct {
  id:          string;
  title:       string;
  emoji:       string;
  tag:         string;
  price:       number;      // current price
  originalPrice: number | null; // struck-through price (null = no discount)
  discountPct: number | null;   // e.g. 30 → "30% خصم"
  stripeLink:  string;
  badge:       string;
  features:    string[];
  isPopular:   boolean;
  owned:       boolean;     // true if current user purchased
}

export interface CouponState {
  code:       string;
  discount:   number;
  finalPrice: number;
  message:    string;
  valid:      boolean;
}

export interface CheckoutResult {
  orderId:     string;
  checkoutUrl: string;
  total:       number;
}

// ── Query keys ────────────────────────────────────────────
export const QUERY_KEYS = {
  products: (tenantId: string) => ['products', tenantId] as const,
  coupon:   (tenantId: string, code: string, price: number) =>
              ['coupon', tenantId, code, price] as const,
};

// ═════════════════════════════════════════════════════════
//  useProducts — fetches active products, maps to PricingProduct[]
// ═════════════════════════════════════════════════════════
export function useProducts(tenantId: string): UseQueryResult<PricingProduct[]> {
  const { user } = useQum();

  return useQuery({
    queryKey: QUERY_KEYS.products(tenantId),
    queryFn:  () => fetchProducts(tenantId, user?.purchasedBooks ?? []),
    staleTime: 5 * 60_000,   // 5 min — products rarely change
    gcTime:    10 * 60_000,
    retry:     2,
    refetchOnWindowFocus: false,
  });
}

// ═════════════════════════════════════════════════════════
//  useCoupon — debounced coupon validation
// ═════════════════════════════════════════════════════════
export function useCoupon(tenantId: string, price: number) {
  const [rawCode, setRawCode] = useState('');
  const [applied, setApplied] = useState<CouponState | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEYS.coupon(tenantId, rawCode, price),
    queryFn:  () => validateCoupon(tenantId, rawCode, price),
    enabled:  rawCode.length >= 3,
    staleTime: 30_000,
    retry:     0,          // coupon errors are user errors — don't retry
  });

  const apply = useCallback(async (code: string) => {
    const clean = code.trim().toUpperCase();
    setRawCode(clean);
  }, []);

  const clear = useCallback(() => {
    setRawCode('');
    setApplied(null);
  }, []);

  // Sync query result → applied state
  if (query.data && !applied) setApplied(query.data);
  if (query.isError && applied) setApplied(null);

  return { apply, clear, applied, isLoading: query.isFetching, error: query.error };
}

// ═════════════════════════════════════════════════════════
//  useCreateOrder — mutation: builds cart → POST /api/v1/checkout
// ═════════════════════════════════════════════════════════
export function useCreateOrder(tenantId: string): UseMutationResult<
  CheckoutResult,
  Error,
  {
    productIds:  string[];
    name:        string;
    email:       string;
    phone?:      string;
    couponCode?: string;
    method:      'visa' | 'mastercard';
  }
> {
  const { user }        = useQum();
  const queryClient     = useQueryClient();

  return useMutation({
    mutationFn: (vars) => createOrder({
      tenantId,
      uid:    user?.uid,
      ...vars,
    }),
    onSuccess: () => {
      // Invalidate products so owned state refreshes after purchase
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products(tenantId) });
    },
  });
}

// ═════════════════════════════════════════════════════════
//  PRIVATE FETCH FUNCTIONS — hidden from components
// ═════════════════════════════════════════════════════════

async function fetchProducts(
  tenantId:      string,
  purchasedBooks: number[],
): Promise<PricingProduct[]> {
  const res = await fetch(`/api/products?tenantId=${encodeURIComponent(tenantId)}`, {
    cache:   'no-store',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'فشل تحميل المنتجات');
  }

  const raw: Product[] = await res.json();

  return raw.map((p): PricingProduct => {
    const hasDiscount    = p.oldPrice !== null && p.oldPrice > p.price;
    const discountPct    = hasDiscount
      ? Math.round((1 - p.price / p.oldPrice!) * 100)
      : null;

    return {
      id:            p.productId,
      title:         p.title,
      emoji:         p.emoji,
      tag:           p.tag,
      price:         p.price,
      originalPrice: hasDiscount ? p.oldPrice! : null,
      discountPct,
      stripeLink:    p.stripeLink,
      badge:         p.badge,
      features:      [],        // populated from Firestore subcollection or static map
      isPopular:     p.badge === 'الأكثر طلباً',
      owned:         purchasedBooks.includes(Number(p.productId.replace(/\D/g, ''))),
    };
  });
}

async function validateCoupon(
  tenantId: string,
  code:     string,
  price:    number,
): Promise<CouponState> {
  const res = await fetch('/api/coupon', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ tenantId, code, price }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'كوبون غير صحيح');

  return {
    code,
    discount:   data.discount,
    finalPrice: data.finalPrice,
    message:    data.message,
    valid:      true,
  };
}

async function createOrder(vars: {
  tenantId:    string;
  uid?:        string;
  productIds:  string[];
  name:        string;
  email:       string;
  phone?:      string;
  couponCode?: string;
  method:      'visa' | 'mastercard';
}): Promise<CheckoutResult> {
  const res = await fetch('/api/v1/checkout', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(vars),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'فشل إنشاء الطلب');

  return {
    orderId:     data.orderId,
    checkoutUrl: data.checkoutUrl,
    total:       data.total,
  };
}
