'use client';
// src/components/Providers.tsx
// Client boundary: يستقبل session من RSC → يُهيّئ Firebase Auth listener
// التدفق: session prop (RSC) → useState → onAuthStateChanged (Firebase)
// لا re-fetch للبيانات — نبدأ من الـ session المُمرَّرة مباشرة

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { clientAuth, clientDb } from '@/lib/firebase-client';
import type { SessionUser } from '@/lib/session';

// ── Cart ────────────────────────────────────────────────
export interface CartItem {
  id:          number;
  title:       string;
  emoji:       string;
  price:       number;
  stripeLink:  string;
}

// ── Context shape ────────────────────────────────────────
interface QumContext {
  // Auth
  user:        SessionUser | null;
  authLoading: boolean;
  // Cart
  cart:        CartItem[];
  addToCart:   (item: CartItem) => void;
  removeFromCart: (id: number) => void;
  clearCart:   () => void;
  cartTotal:   number;
  // Toast
  toast:       (msg: string, type?: 'ok' | 'err') => void;
}

const Ctx = createContext<QumContext | null>(null);

export function useQum() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useQum must be inside <Providers>');
  return c;
}

// ── Toast internal state ─────────────────────────────────
interface ToastState { msg: string; type: 'ok' | 'err'; id: number }

// ── Providers Component ──────────────────────────────────
export function Providers({
  children,
  session,
  nonce,
}: {
  children: ReactNode;
  session:  SessionUser | null;
  nonce:    string;
}) {
  // Seed user from RSC session — no loading flash
  const [user, setUser]             = useState<SessionUser | null>(session);
  const [authLoading, setLoading]   = useState(!session); // false if RSC gave us a session
  const [cart, setCart]             = useState<CartItem[]>([]);
  const [toastState, setToast]      = useState<ToastState | null>(null);
  const toastTimer                  = useRef<ReturnType<typeof setTimeout>>();

  // ── Firebase Auth Listener ──
  // يُزامن الـ session مع Firebase Auth بعد hydration
  // إذا RSC أعطانا session صحيح → لا نُعيد الجلب إلا عند تغيير Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth, async (fbUser: FirebaseUser | null) => {
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // إذا عندنا session من RSC بنفس الـ uid → لا نُعيد الجلب
      if (session?.uid === fbUser.uid) {
        setUser(session);
        setLoading(false);
        return;
      }

      // Auth تغيّر (مثلاً: دخل من تبويب آخر) → جلب من Firestore
      try {
        const snap = await getDoc(doc(clientDb, 'users', fbUser.uid));
        if (snap.exists()) {
          const d = snap.data();
          setUser({
            uid:             fbUser.uid,
            name:            d.name            ?? fbUser.displayName ?? '',
            email:           d.email           ?? fbUser.email ?? '',
            purchasedBooks:  d.purchasedBooks  ?? [],
            readingProgress: d.readingProgress ?? {},
            plan:            d.plan            ?? 'free',
            isAdmin:         d.isAdmin         === true,
          });
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return unsub; // cleanup
  }, []); // يُشغَّل مرة واحدة

  // ── Cart ──
  const addToCart = useCallback((item: CartItem) => {
    setCart(prev => prev.some(c => c.id === item.id) ? prev : [...prev, item]);
  }, []);

  const removeFromCart = useCallback((id: number) => {
    setCart(prev => prev.filter(c => c.id !== id));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const cartTotal = cart.reduce((s, c) => s + c.price, 0);

  // ── Toast ──
  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ── Reading progress sync ──
  // يُستدعى من PdfReader عند تغيير الصفحة
  useEffect(() => {
    (window as any).__qumUpdateProgress = async (bookId: number, pct: number) => {
      if (!user?.uid) return;
      try {
        await updateDoc(doc(clientDb, 'users', user.uid), {
          [`readingProgress.${bookId}`]: pct,
        });
        setUser(prev => prev
          ? { ...prev, readingProgress: { ...prev.readingProgress, [bookId]: pct } }
          : prev
        );
      } catch {}
    };
  }, [user?.uid]);

  return (
    <Ctx.Provider value={{ user, authLoading, cart, addToCart, removeFromCart, clearCart, cartTotal, toast }}>
      {children}

      {/* Global Toast — mounted once at root */}
      {toastState && (
        <div
          key={toastState.id}
          role="status"
          aria-live="polite"
          className={[
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]',
            'px-5 py-3 rounded-full text-sm font-semibold',
            'shadow-lg backdrop-blur-sm animate-toast',
            toastState.type === 'err'
              ? 'bg-dark4 border border-red-500/40 text-red-400'
              : 'bg-dark4 border border-blue-500/30 text-qum-text',
          ].join(' ')}
        >
          {toastState.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
