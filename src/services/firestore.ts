// src/services/firestore.ts
// Direct Firestore service — no repositories, no abstract layers
// UI calls these functions directly. That's it.
// Server functions use adminDb. Client functions use clientDb.

import {
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit,
  getDocs, serverTimestamp, arrayUnion, increment,
  type Firestore,
} from 'firebase/firestore';
import { clientDb } from '@/lib/firebase-client';
import { adminDb, FieldValue } from '@/lib/firebase-admin';
import type {
  User, UserUpdate,
  Product, ProductUpdate,
  Order, Coupon, Log, LogEvent,
  SiteConfig, Tenant,
} from '@/lib/types';

// ── path helpers ─────────────────────────────────────────
const p = {
  tenant:  (tid: string)               => `tenants/${tid}`,
  user:    (tid: string, uid: string)  => `tenants/${tid}/users/${uid}`,
  product: (tid: string, pid: string)  => `tenants/${tid}/products/${pid}`,
  order:   (tid: string, oid: string)  => `tenants/${tid}/orders/${oid}`,
  coupon:  (tid: string, code: string) => `tenants/${tid}/coupons/${code}`,
  log:     (tid: string)               => `tenants/${tid}/logs`,
  config:  (tid: string)               => `tenants/${tid}/config/site`,
};

// ════════════════════════════════════════════
//  USERS  (Client SDK)
// ════════════════════════════════════════════

export async function getUser(tenantId: string, uid: string): Promise<User | null> {
  const snap = await getDoc(doc(clientDb, p.user(tenantId, uid)));
  return snap.exists() ? (snap.data() as User) : null;
}

export async function createUser(tenantId: string, data: Omit<User, 'createdAt' | 'updatedAt'>): Promise<void> {
  await setDoc(doc(clientDb, p.user(tenantId, data.uid)), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateUser(tenantId: string, uid: string, data: UserUpdate): Promise<void> {
  await updateDoc(doc(clientDb, p.user(tenantId, uid)), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function updateReadingProgress(
  tenantId: string,
  uid: string,
  bookId: number,
  pct: number,
): Promise<void> {
  await updateDoc(doc(clientDb, p.user(tenantId, uid)), {
    [`readingProgress.${bookId}`]: pct,
    lastReadAt: serverTimestamp(),
    updatedAt:  serverTimestamp(),
  });
}

// ════════════════════════════════════════════
//  PRODUCTS  (Client SDK — public reads)
// ════════════════════════════════════════════

export async function getProducts(tenantId: string): Promise<Product[]> {
  const q    = query(
    collection(clientDb, `tenants/${tenantId}/products`),
    where('active', '==', true),
    orderBy('sortOrder', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Product);
}

export async function getProduct(tenantId: string, productId: string): Promise<Product | null> {
  const snap = await getDoc(doc(clientDb, p.product(tenantId, productId)));
  return snap.exists() ? (snap.data() as Product) : null;
}

// ════════════════════════════════════════════
//  ORDERS  (Client SDK — create; Admin SDK — update)
// ════════════════════════════════════════════

export async function createOrder(
  tenantId: string,
  data: Omit<Order, 'createdAt' | 'paidAt'>,
): Promise<string> {
  const ref = await addDoc(collection(clientDb, `tenants/${tenantId}/orders`), {
    ...data,
    createdAt: serverTimestamp(),
    paidAt:    null,
  });
  return ref.id;
}

// Admin SDK — يُستدعى من stripe-webhook Route Handler فقط
export async function markOrderPaid(
  tenantId: string,
  stripeSessionId: string,
  uid: string,
  bookIds: number[],
): Promise<void> {
  const batch = adminDb.batch();

  // 1. تحديث Order
  const ordersRef = adminDb.collection(`tenants/${tenantId}/orders`);
  const snap      = await ordersRef.where('stripeSessionId', '==', stripeSessionId).limit(1).get();
  if (!snap.empty) {
    batch.update(snap.docs[0].ref, {
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
    });
  }

  // 2. منح الكتب للمستخدم + تحديث الإحصائيات
  if (uid) {
    const userRef = adminDb.doc(`tenants/${tenantId}/users/${uid}`);
    batch.update(userRef, {
      purchasedBooks: FieldValue.arrayUnion(...bookIds),
      ordersCount:    FieldValue.increment(1),
      updatedAt:      FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

// ════════════════════════════════════════════
//  COUPONS  (Client SDK — validate; Admin SDK — increment)
// ════════════════════════════════════════════

export async function getCoupon(tenantId: string, code: string): Promise<Coupon | null> {
  const snap = await getDoc(doc(clientDb, p.coupon(tenantId, code.toUpperCase())));
  return snap.exists() ? (snap.data() as Coupon) : null;
}

// Admin SDK — يُستدعى من coupon Route Handler
export async function incrementCouponUsage(tenantId: string, code: string): Promise<void> {
  await adminDb.doc(`tenants/${tenantId}/coupons/${code.toUpperCase()}`).update({
    usedCount: FieldValue.increment(1),
  });
}

// ════════════════════════════════════════════
//  LOGS  (Client SDK — append only)
//  بدون await في الـ UI — fire-and-forget
// ════════════════════════════════════════════

export function writeLog(
  tenantId: string,
  event: LogEvent,
  uid: string | null,
  meta: Record<string, string | number | boolean>,
  ip = '',
): void {
  // fire-and-forget — لا نوقف الـ UI على تسجيل الحدث
  addDoc(collection(clientDb, p.log(tenantId)), {
    tenantId,
    event,
    uid,
    meta,
    ip,
    createdAt: serverTimestamp(),
  } satisfies Omit<Log, 'logId'>).catch(() => {/* silent */});
}

// Admin SDK — للقراءة في لوحة التحكم
export async function getLogs(
  tenantId: string,
  limitCount = 200,
): Promise<Log[]> {
  const snap = await adminDb
    .collection(`tenants/${tenantId}/logs`)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map(d => ({ logId: d.id, ...d.data() }) as Log);
}

// ════════════════════════════════════════════
//  SITE CONFIG  (Client SDK)
// ════════════════════════════════════════════

export async function getSiteConfig(tenantId: string): Promise<SiteConfig | null> {
  const snap = await getDoc(doc(clientDb, p.config(tenantId)));
  return snap.exists() ? (snap.data() as SiteConfig) : null;
}

// Admin SDK — لوحة التحكم فقط
export async function saveSiteConfig(tenantId: string, data: Partial<SiteConfig>): Promise<void> {
  await adminDb.doc(`tenants/${tenantId}/config/site`).set(
    { ...data, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

// ════════════════════════════════════════════
//  ADMIN READS  (Admin SDK — Route Handlers)
// ════════════════════════════════════════════

export async function getOrders(tenantId: string, limitCount = 100): Promise<Order[]> {
  const snap = await adminDb
    .collection(`tenants/${tenantId}/orders`)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map(d => ({ orderId: d.id, ...d.data() }) as Order);
}

export async function getUsers(tenantId: string, limitCount = 200): Promise<User[]> {
  const snap = await adminDb
    .collection(`tenants/${tenantId}/users`)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map(d => d.data() as User);
}

export async function getLeads(tenantId: string, limitCount = 200): Promise<Log[]> {
  const snap = await adminDb
    .collection(`tenants/${tenantId}/logs`)
    .where('event', 'in', ['order.created', 'order.paid'])
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map(d => ({ logId: d.id, ...d.data() }) as Log);
}

// Admin — تحديث حالة منتج
export async function adminUpdateProduct(
  tenantId: string,
  productId: string,
  data: ProductUpdate,
): Promise<void> {
  await adminDb.doc(`tenants/${tenantId}/products/${productId}`).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
