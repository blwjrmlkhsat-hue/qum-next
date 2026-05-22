// src/lib/types.ts
// Flat TypeScript types — direct mirror of Firestore documents
// Path: /tenants/{tenantId}/{collection}/{id}
// No abstract wrappers. No ORMs. What you see is what's in Firestore.

import type { Timestamp } from 'firebase/firestore';

// ════════════════════════════════════════════
//  TENANT
//  /tenants/{tenantId}
// ════════════════════════════════════════════
export interface Tenant {
  tenantId:    string;           // = doc ID
  name:        string;           // اسم المتجر
  ownerId:     string;           // uid صاحب المتجر (Firebase Auth)
  plan:        'free' | 'pro';
  stripeLink:  string;           // رابط Stripe Payment Link الافتراضي
  waNumber:    string;           // رقم واتساب
  createdAt:   Timestamp;
}

// ════════════════════════════════════════════
//  USER
//  /tenants/{tenantId}/users/{uid}
// ════════════════════════════════════════════
export interface User {
  uid:              string;       // = Firebase Auth uid = doc ID
  tenantId:         string;       // للتحقق السريع داخل القاعدة
  name:             string;
  email:            string;
  isAdmin:          boolean;      // يُعيَّن يدوياً من المالك
  plan:             'free' | 'pro';

  // ── Wallet / Purchase stats ──
  purchasedBooks:   number[];     // مصفوفة معرّفات الكتب المشتراة
  totalSpent:       number;       // ريال — يُحدَّث بعد كل دفعة ناجحة
  ordersCount:      number;       // عدد الطلبات المكتملة

  // ── Reading state ──
  readingProgress:  Record<string, number>; // bookId → percent (0-100)
  lastReadAt:       Timestamp | null;

  createdAt:        Timestamp;
  updatedAt:        Timestamp;
}

// ── Partial used in Firestore updateDoc calls ──
export type UserUpdate = Partial<Pick<
  User,
  'name' | 'purchasedBooks' | 'totalSpent' |
  'ordersCount' | 'readingProgress' | 'lastReadAt' | 'updatedAt'
>>;

// ════════════════════════════════════════════
//  PRODUCT (Book)
//  /tenants/{tenantId}/products/{productId}
// ════════════════════════════════════════════
export interface Product {
  productId:    string;           // = doc ID (e.g. "book-001")
  tenantId:     string;
  type:         'book' | 'package';

  // ── Display ──
  title:        string;
  description:  string;
  emoji:        string;
  tag:          string;           // تصنيف: "تطوير الذات", "علاقات"...
  badge:        string;           // "جديد" | "الأكثر طلباً" | ""

  // ── Pricing ──
  price:        number;           // ريال
  oldPrice:     number | null;    // للعرض الشطب — null إذا لا يوجد
  stripeLink:   string;           // رابط Payment Link هذا المنتج

  // ── Delivery ──
  pdfPath:      string;           // مسار Cloudinary: "qum/books/book-001.pdf"

  // ── Package-only ──
  includesIds:  string[];         // معرّفات الكتب في الباقة (فارغة إذا book)

  // ── State ──
  active:       boolean;
  sortOrder:    number;           // للترتيب في الواجهة

  createdAt:    Timestamp;
  updatedAt:    Timestamp;
}

export type ProductUpdate = Partial<Pick<
  Product,
  'title' | 'description' | 'emoji' | 'tag' | 'badge' |
  'price' | 'oldPrice' | 'stripeLink' | 'pdfPath' |
  'active' | 'sortOrder' | 'updatedAt'
>>;

// ════════════════════════════════════════════
//  ORDER
//  /tenants/{tenantId}/orders/{orderId}
// ════════════════════════════════════════════
export interface Order {
  orderId:         string;         // = Stripe session ID
  tenantId:        string;
  uid:             string;         // مشتري مسجّل (فارغ إذا guest)
  email:           string;
  name:            string;
  phone:           string;

  productIds:      string[];       // معرّفات المنتجات المشتراة
  bookIds:         number[];       // معرّفات الكتب (بعد توسيع الباقات)
  couponCode:      string | null;
  subtotal:        number;
  discount:        number;
  total:           number;
  currency:        'SAR';

  stripeSessionId: string;
  status:          'pending' | 'paid' | 'refunded' | 'failed';

  createdAt:       Timestamp;
  paidAt:          Timestamp | null;
}

// ════════════════════════════════════════════
//  LOG
//  /tenants/{tenantId}/logs/{logId}
//  Append-only. Never updated. Under 100ms writes.
// ════════════════════════════════════════════
export type LogEvent =
  | 'user.register'
  | 'user.login'
  | 'order.created'
  | 'order.paid'
  | 'order.refunded'
  | 'book.opened'
  | 'coupon.applied'
  | 'admin.login'
  | 'deliver.token_generated'
  | 'deliver.token_used'
  | 'deliver.token_expired';

export interface Log {
  logId:      string;              // = doc ID (auto)
  tenantId:   string;
  event:      LogEvent;
  uid:        string | null;       // null للأحداث العامة (guest)
  meta:       Record<string, string | number | boolean>; // بيانات الحدث
  ip:         string;              // من x-forwarded-for
  createdAt:  Timestamp;           // serverTimestamp() — لا يُعدَّل
}

// ── LogEvent meta shapes (للتوثيق) ──
export type LogMeta = {
  'user.register':           { email: string };
  'user.login':              { email: string };
  'order.created':           { orderId: string; total: number };
  'order.paid':              { orderId: string; bookIds: string };
  'book.opened':             { bookId: number; pct: number };
  'coupon.applied':          { code: string; discount: number };
  'deliver.token_generated': { bookId: number; orderId: string };
  'deliver.token_used':      { bookId: number };
  'deliver.token_expired':   { bookId: number };
};

// ════════════════════════════════════════════
//  COUPON
//  /tenants/{tenantId}/coupons/{code}
//  doc ID = كود الكوبون بالأحرف الكبيرة
// ════════════════════════════════════════════
export interface Coupon {
  code:       string;              // = doc ID
  tenantId:   string;
  type:       'pct' | 'fixed';    // نسبة مئوية أو مبلغ ثابت
  value:      number;             // 20 → 20% أو 20 ريال
  maxUses:    number | null;      // null = غير محدود
  usedCount:  number;             // يُحدَّث عبر increment() في Route Handler
  expiresAt:  Timestamp | null;
  active:     boolean;
  createdAt:  Timestamp;
}

// ════════════════════════════════════════════
//  CONFIG (Site settings)
//  /tenants/{tenantId}/config/site
//  وثيقة واحدة ثابتة
// ════════════════════════════════════════════
export interface SiteConfig {
  brand: {
    name:     string;
    tagline:  string;
    logoUrl:  string | null;
    fontH:    string;
    fontB:    string;
  };
  theme: {
    blue:   string;
    dark:   string;
    preset: number;
  };
  social: {
    whatsapp:  string;
    instagram: string;
    twitter:   string;
    snapchat:  string;
    tiktok:    string;
  };
  updatedAt: Timestamp;
}
