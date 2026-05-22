# دليل النشر على Netlify — قُم Next.js
# خطوة بخطوة من الصفر حتى الإنتاج

---

## الخطوة 1: تجهيز جهازك (مرة واحدة فقط)

افتح Terminal وتحقق أن Node.js مثبت:

```bash
node --version   # يجب أن يكون 20+
npm --version
```

إذا لم يكن مثبتاً: https://nodejs.org → حمّل LTS

---

## الخطوة 2: فك الضغط وتثبيت المشروع

```bash
# 1. فك ضغط الملف
unzip qum-next.zip
cd qum-next

# 2. تثبيت الحزم
npm install

# 3. تشغيل محلياً للتحقق
npm run dev
# افتح http://localhost:3000
```

---

## الخطوة 3: رفع المشروع على GitHub

```bash
# داخل مجلد qum-next
git init
git add .
git commit -m "init: qum-next full stack"

# اذهب إلى github.com → New repository → اسمه: qum-next
# ثم:
git remote add origin https://github.com/YOUR_USERNAME/qum-next.git
git push -u origin main
```

---

## الخطوة 4: ربط GitHub بـ Netlify

1. اذهب إلى **app.netlify.com**
2. اضغط **"Add new site" → "Import an existing project"**
3. اختر **GitHub** → وصّل حسابك
4. اختر الـ repository: `qum-next`
5. في إعدادات البناء:
   - **Build command:** `npm run build`
   - **Publish directory:** `.next`
   - **Node version:** `20`
6. اضغط **"Deploy site"** — انتظر 2-3 دقائق

---

## الخطوة 5: إضافة Environment Variables (المهم)

في Netlify Dashboard:
**Site Settings → Environment Variables → Add a variable**

أضف كل متغير من هذه القائمة:

### Firebase Client (NEXT_PUBLIC — مرئي)
```
NEXT_PUBLIC_FIREBASE_API_KEY         = AIzaSy-xxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN     = your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID      = your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET  = your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 123456789
NEXT_PUBLIC_FIREBASE_APP_ID          = 1:xxx:web:xxx
```

### Firebase Admin (سري — خادم فقط)
```
FIREBASE_PROJECT_ID      = your-project-id
FIREBASE_CLIENT_EMAIL    = firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY     = -----BEGIN PRIVATE KEY-----\nxxx\n-----END PRIVATE KEY-----\n
```
⚠️ مهم: في FIREBASE_PRIVATE_KEY — انسخ المفتاح كاملاً من ملف JSON بما فيه줄 \n

### Stripe
```
STRIPE_SECRET_KEY        = sk_live_xxx
STRIPE_WEBHOOK_SECRET    = whsec_xxx
```

### Upstash Redis
```
UPSTASH_REDIS_REST_URL   = https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN = xxx
```

### Cloudinary
```
CLOUDINARY_CLOUD   = your-cloud-name
CLOUDINARY_KEY     = your-api-key
CLOUDINARY_SECRET  = your-api-secret
```

### Resend (Email)
```
RESEND_API_KEY  = re_xxx
EMAIL_FROM      = قُم <books@qum.sa>
```

### LiveKit
```
LIVEKIT_API_KEY    = pk_xxx
LIVEKIT_API_SECRET = sk_xxx
LIVEKIT_URL        = wss://your-project.livekit.cloud
```

### Misc
```
DELIVERY_SECRET           = أي-نص-عشوائي-32-حرف-أو-أكثر
ESNS_SECRET               = أي-نص-آخر-عشوائي
NEXT_PUBLIC_SITE_URL      = https://your-site.netlify.app
NEXT_PUBLIC_APP_VERSION   = 1.0.0
NEXT_PUBLIC_WA_NUMBER     = 966505814917
```

بعد الإضافة → **Trigger deploy** → **Redeploy site**

---

## الخطوة 6: إعداد Firebase

### 6a. إنشاء المشروع
1. اذهب إلى **console.firebase.google.com**
2. **Create project** → أي اسم
3. **Build → Firestore Database → Create database** → Production mode
4. **Build → Authentication → Get started → Email/Password** → Enable

### 6b. رفع Firestore Rules
1. في Firebase Console → **Firestore → Rules**
2. انسخ محتوى ملف `firestore.rules` والصقه كاملاً
3. اضغط **Publish**

### 6c. إعداد TTL للـ Logs
1. **Firestore → Indexes → TTL policies**
2. اضغط **Create TTL policy**
3. Collection: `tenants/{tenantId}/logs` — Field: `expiresAt`

### 6d. الحصول على Admin SDK Key
1. **Project Settings (⚙️) → Service Accounts**
2. **Generate new private key** → حمّل JSON
3. افتح الملف وانسخ:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY`

---

## الخطوة 7: إعداد Stripe Webhook

1. اذهب إلى **dashboard.stripe.com → Webhooks**
2. اضغط **"Add endpoint"**
3. في **Endpoint URL**:
   ```
   https://your-site.netlify.app/api/stripe-webhook
   ```
4. في **Events to listen**، اختر:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. اضغط **Add endpoint**
6. انسخ **Signing secret** (whsec_xxx) → ضعه في `STRIPE_WEBHOOK_SECRET`

---

## الخطوة 8: إعداد Upstash Redis

1. اذهب إلى **console.upstash.com**
2. **Create database** → اختر أقرب region
3. من صفحة قاعدة البيانات انسخ:
   - **REST URL** → `UPSTASH_REDIS_REST_URL`
   - **REST Token** → `UPSTASH_REDIS_REST_TOKEN`

---

## الخطوة 9: إعداد Cloudinary

1. اذهب إلى **cloudinary.com → Dashboard**
2. انسخ:
   - **Cloud name** → `CLOUDINARY_CLOUD`
   - **API Key** → `CLOUDINARY_KEY`
   - **API Secret** → `CLOUDINARY_SECRET`
3. **Settings → Upload → Upload presets** → أنشئ preset باسم `qum_books`
4. أنشئ مجلد `qum/books` في **Media Library**

---

## الخطوة 10: إعداد Resend (البريد)

1. اذهب إلى **resend.com → API Keys → Create API Key**
2. انسخ المفتاح → `RESEND_API_KEY`
3. **Domains → Add Domain** → أضف نطاقك وتحقق منه
4. غيّر `EMAIL_FROM` للدومين المتحقق منه

---

## الخطوة 11: إعداد LiveKit (اختياري — للـ Community)

1. اذهب إلى **cloud.livekit.io → New Project**
2. انسخ:
   - **API Key** → `LIVEKIT_API_KEY`
   - **API Secret** → `LIVEKIT_API_SECRET`
   - **WSS URL** → `LIVEKIT_URL`

---

## الخطوة 12: ربط الدومين المخصص (اختياري)

في Netlify:
1. **Domain management → Add custom domain**
2. أضف `qum.sa`
3. في DNS provider أضف:
   ```
   CNAME  www   your-site.netlify.app
   A      @     75.2.60.5
   ```
4. SSL يُفعّل تلقائياً خلال دقائق

---

## التحقق النهائي ✅

بعد النشر الكامل، تحقق من:

```
✅ الموقع يفتح على HTTPS
✅ تسجيل الدخول يعمل (Firebase Auth)
✅ الشراء يفتح Stripe (Payment Link)
✅ Webhook يُسجّل في Stripe Dashboard
✅ البريد يصل بعد الدفع (Resend)
✅ الكتب تظهر في مكتبة المستخدم
✅ CSP headers تظهر في DevTools → Network → Response Headers
```

---

## هيكل الملفات النهائي

```
qum-next/
├── .env.local              ← لا ترفعه (مضاف في .gitignore)
├── firestore.rules         ← ارفعه في Firebase Console يدوياً
├── middleware.ts           ← Rate limiting + CSP + Route guards
├── netlify.toml            ← Headers + Build config
├── package.json
└── src/
    ├── app/
    │   ├── layout.tsx              ← Auth injection
    │   └── api/
    │       ├── v1/checkout/        ← Checkout flow
    │       ├── stripe-webhook/     ← Payment confirmation
    │       ├── deliver/            ← PDF delivery
    │       ├── coupon/             ← Coupon validation
    │       ├── auth/session/       ← Session cookie
    │       ├── assets/upload/      ← File upload
    │       ├── assets/serve/       ← Signed URL redirect
    │       ├── livekit/token/      ← LiveKit JWT
    │       └── csp-report/        ← CSP violation log
    ├── components/
    │   ├── Providers.tsx           ← Firebase Auth context
    │   ├── PricingBlock.tsx        ← Value-stacking checkout UI
    │   ├── CommunityFeed.tsx       ← Real-time chat
    │   └── ProtectedCanvas.tsx     ← Forensic watermark
    ├── hooks/
    │   ├── useCheckout.ts          ← TanStack Query wiring
    │   └── useChatFeed.ts          ← Firestore real-time
    ├── lib/
    │   ├── firebase-admin.ts       ← Server singleton
    │   ├── firebase-client.ts      ← Client singleton
    │   ├── session.ts              ← getServerSession (RSC)
    │   ├── errors.ts               ← Error taxonomy
    │   ├── schemas.ts              ← Zod validators
    │   ├── types.ts                ← TypeScript types
    │   └── upstash-client.ts       ← Redis singleton
    └── services/
        ├── auth.ts                 ← signIn/signUp/signOut
        ├── firestore.ts            ← All DB reads/writes
        ├── coupon.ts               ← Coupon validation
        ├── asset.ts                ← Upload/serve helpers
        └── telemetry.ts            ← Unified logging
```
