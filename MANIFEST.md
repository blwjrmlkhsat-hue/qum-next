# قُم — Flat Project Manifest
# Next.js 14 · App Router · Firebase · Upstash
# Solo Dev Layout: zero abstraction layers, max scan speed

qum/
├── src/
│   │
│   ├── app/                              # RSC pages + layouts (App Router)
│   │   │
│   │   ├── layout.tsx                   # ROOT: auth injection, session, providers
│   │   ├── page.tsx                     # Store homepage (RSC, reads config from Firestore)
│   │   ├── not-found.tsx                # 404
│   │   ├── error.tsx                    # Global error boundary
│   │   │
│   │   ├── (auth)/                      # Route group — no layout segment in URL
│   │   │   ├── login/page.tsx           # Login form (Client Component)
│   │   │   └── register/page.tsx        # Register form (Client Component)
│   │   │
│   │   ├── library/                     # Protected: requires auth + purchase
│   │   │   ├── page.tsx                 # My Library — lists owned books (RSC)
│   │   │   └── [bookId]/page.tsx        # PDF Reader page (RSC shell + client viewer)
│   │   │
│   │   ├── checkout/
│   │   │   └── page.tsx                 # Checkout (RSC prefills user data)
│   │   │
│   │   ├── admin/
│   │   │   ├── page.tsx                 # Dashboard — orders, leads, users (RSC)
│   │   │   ├── orders/page.tsx          # Orders list
│   │   │   ├── leads/page.tsx           # Contact leads
│   │   │   └── users/page.tsx           # Registered users
│   │   │
│   │   └── api/                         # Route Handlers (replaces Netlify Functions)
│   │       ├── stripe-webhook/route.ts  # POST: verify → Firestore → deliver → email
│   │       ├── deliver/route.ts         # GET ?token=xxx → stream PDF from Cloudinary
│   │       └── coupon/route.ts          # POST: validate coupon server-side
│   │
│   ├── services/                        # Flat service files — UI never touches DB directly
│   │   ├── auth.ts                      # signIn, signUp, signOut, resetPassword, getSession
│   │   ├── firestore.ts                 # All Firestore reads/writes (admin + client)
│   │   ├── stripe.ts                    # createCheckoutSession, verifyWebhook
│   │   ├── deliver.ts                   # generateToken, verifyToken, streamFromCloudinary
│   │   ├── coupon.ts                    # validateCoupon, incrementUsage (Upstash)
│   │   ├── email.ts                     # sendDeliveryEmail via EmailJS/Resend
│   │   └── upstash.ts                   # rate limiting, token blacklist, coupon counters
│   │
│   ├── components/                      # Shallow UI pieces — no sub-folders
│   │   ├── Providers.tsx                # Client: Firebase Auth provider + context
│   │   ├── NavBar.tsx                   # Client: auth state, cart icon, user menu
│   │   ├── BookCard.tsx                 # Client: add to cart, owned state, read button
│   │   ├── BookGrid.tsx                 # RSC: renders BookCard list from props
│   │   ├── PricingCard.tsx              # Client: buy package button
│   │   ├── CartDrawer.tsx               # Client: cart state, checkout trigger
│   │   ├── AuthModal.tsx                # Client: login/register tabs modal
│   │   ├── PdfReader.tsx                # Client: iframe viewer, zoom, progress tracking
│   │   ├── LibraryGrid.tsx              # Client: owned books grid with progress bars
│   │   ├── CheckoutForm.tsx             # Client: order form + coupon + Stripe redirect
│   │   ├── CountdownTimer.tsx           # Client: hydrated timer
│   │   ├── Toast.tsx                    # Client: global toast (zustand or context)
│   │   └── AiChat.tsx                   # Client: AI assistant widget
│   │
│   └── lib/                             # Pure utilities — no side effects
│       ├── firebase-client.ts           # initializeApp (client SDK singleton)
│       ├── firebase-admin.ts            # initializeApp (admin SDK singleton for Route Handlers)
│       ├── upstash-client.ts            # Redis client singleton
│       ├── session.ts                   # getServerSession: reads Firebase ID token from cookie
│       └── constants.ts                 # BOOK_CATALOG, THEMES, DEF_PKGS, DEF_TESTS
│
├── public/
│   └── favicon.ico
│
├── .env.local                           # All secrets — never committed
├── next.config.ts                       # headers(), rewrites for /admin
├── middleware.ts                        # Edge: protect /library, /admin, /checkout
└── package.json
