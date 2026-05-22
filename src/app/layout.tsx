// src/app/layout.tsx
// ROOT SERVER COMPONENT
// Flow: cookie → verify Firebase ID token → inject session → Providers (client)
// No event bus. No context juggling. One pass, top-down.

import type { Metadata, Viewport } from 'next';
import { Cairo, Tajawal } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { getServerSession } from '@/lib/session';
import { Providers } from '@/components/Providers';
import type { SessionUser } from '@/lib/session';
import './globals.css';

// ── Fonts ──────────────────────────────────────────────
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight:  ['400', '600', '700', '900'],
  variable: '--font-cairo',
  display: 'swap',
});

const tajawal = Tajawal({
  subsets: ['arabic'],
  weight:  ['400', '700', '900'],
  variable: '--font-tajawal',
  display: 'swap',
});

// ── Static metadata (dynamic pages override per-segment) ──
export const metadata: Metadata = {
  title:       { default: 'قُم — كتب تنهض بروحك', template: '%s | قُم' },
  description: 'اشتر مرة واقرأ للأبد. كتب نفسية وتطوير ذات مختارة بعناية.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://qum.sa'),
  openGraph: {
    siteName: 'قُم',
    locale:   'ar_SA',
    type:     'website',
  },
};

export const viewport: Viewport = {
  width:        'device-width',
  initialScale:  1,
  maximumScale:  1,
  themeColor:   '#080C14',
};

// ── Root Layout ──────────────────────────────────────────
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1. استخراج Firebase ID token من الكوكي (httpOnly)
  //    Middleware يضعه هناك بعد signIn ناجح
  const cookieStore = cookies();
  const idToken = cookieStore.get('qum_session')?.value ?? null;

  // 2. التحقق من التوكن وجلب بيانات المستخدم من Firestore
  //    إذا التوكن منتهٍ أو غير صالح → session = null (لا exception)
  //    دالة واحدة متسلسلة: verifyIdToken → getDoc(users/{uid}) → return
  const session: SessionUser | null = idToken
    ? await getServerSession(idToken)
    : null;

  // 3. قراءة CSP nonce من headers (تُعيّنه middleware)
  const nonce = headers().get('x-nonce') ?? '';

  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${tajawal.variable}`}>
      <head>
        {/* Preconnect — يُسرّع Firebase + Fonts */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.gstatic.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />

        {/* Security: CSP nonce للسكربتات الخارجية */}
        {nonce && (
          <meta name="csp-nonce" content={nonce} />
        )}
      </head>
      <body className="bg-dark text-qum-text antialiased">
        {/*
          Providers = Client Component
          يستقبل session من RSC ويهيّئ:
            - Firebase Auth listener (onAuthStateChanged)
            - Cart state (zustand أو context)
            - Toast state
          لا يُعيد جلب البيانات — يستخدم session المُمرَّر مباشرة
        */}
        <Providers session={session} nonce={nonce}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
