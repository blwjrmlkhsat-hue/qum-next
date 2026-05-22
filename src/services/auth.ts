// src/services/auth.ts
// Sequential auth functions: Firebase Auth -> Firestore write -> session cookie
// Called from Server Actions or Route Handlers only.
// Client Components call these via fetch('/api/auth/...').

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  type UserCredential,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { clientAuth, clientDb }         from '@/lib/firebase-client';
import { adminAuth }                    from '@/lib/firebase-admin';
import { Err }                          from '@/lib/errors';
import type { User }                    from '@/lib/types';

// ── Register: Auth -> Firestore -> return profile ─────────
export async function signUp(
  tenantId: string,
  name:     string,
  email:    string,
  password: string,
): Promise<User> {
  let cred: UserCredential;
  try {
    cred = await createUserWithEmailAndPassword(clientAuth, email, password);
  } catch (e: any) {
    if (e.code === 'auth/email-already-in-use') throw Err.input('هذا البريد الإلكتروني مسجّل مسبقاً');
    if (e.code === 'auth/weak-password')         throw Err.input('كلمة المرور ضعيفة جداً — 8 أحرف على الأقل');
    throw Err.system(e);
  }

  const uid = cred.user.uid;

  // Update display name in Auth
  await updateProfile(cred.user, { displayName: name }).catch(() => {});

  // Write Firestore profile
  const profile: Omit<User, 'createdAt' | 'updatedAt'> = {
    uid, tenantId, name, email,
    isAdmin:         false,
    plan:            'free',
    purchasedBooks:  [],
    totalSpent:      0,
    ordersCount:     0,
    readingProgress: {},
    lastReadAt:      null,
  };

  try {
    await setDoc(doc(clientDb, `tenants/${tenantId}/users/${uid}`), {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    // Firestore write failed — delete Auth user to avoid orphan
    await cred.user.delete().catch(() => {});
    throw Err.system(e);
  }

  return { ...profile, createdAt: null as any, updatedAt: null as any };
}

// ── Login: Auth -> return ID token for session cookie ─────
export async function signIn(
  email:    string,
  password: string,
): Promise<{ idToken: string; uid: string }> {
  let cred: UserCredential;
  try {
    cred = await signInWithEmailAndPassword(clientAuth, email, password);
  } catch (e: any) {
    const map: Record<string, string> = {
      'auth/user-not-found':      'البريد الإلكتروني غير مسجّل',
      'auth/wrong-password':      'كلمة المرور غير صحيحة',
      'auth/invalid-credential':  'بيانات الدخول غير صحيحة',
      'auth/too-many-requests':   'محاولات كثيرة — انتظر قليلاً ثم حاول',
      'auth/user-disabled':       'هذا الحساب موقوف — تواصل مع الدعم',
    };
    throw Err.deny(map[e.code] ?? 'فشل تسجيل الدخول');
  }

  const idToken = await cred.user.getIdToken();
  return { idToken, uid: cred.user.uid };
}

// ── Logout: clear client Auth state ──────────────────────
export async function logOut(): Promise<void> {
  await signOut(clientAuth).catch(() => {});
}

// ── Reset password ────────────────────────────────────────
export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(clientAuth, email);
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') throw Err.input('هذا البريد غير مسجّل');
    throw Err.system(e);
  }
}

// ── Verify ID token (server-side via Admin SDK) ───────────
// Returns uid or throws Err.deny
export async function verifyIdToken(idToken: string): Promise<string> {
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    return decoded.uid;
  } catch {
    throw Err.deny('Session منتهية — سجّل دخولك مجدداً');
  }
}

// ── Set custom claims (isAdmin) — called once manually ────
export async function setAdminClaim(uid: string, isAdmin: boolean): Promise<void> {
  await adminAuth.setCustomUserClaims(uid, { isAdmin });
}
