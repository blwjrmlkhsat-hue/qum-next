// src/lib/firebase-admin.ts
// Singleton Firebase Admin — يُستخدم فقط في:
//   - src/lib/session.ts (layout.tsx)
//   - src/app/api/*/route.ts (Route Handlers)
// لا يُستورَد أبداً من Client Components

import {
  initializeApp,
  getApps,
  cert,
  type App,
} from 'firebase-admin/app';
import { getAuth,  type Auth        } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

function initAdmin(): App {
  if (getApps().length) return getApps()[0];

  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '')
    .replace(/\\n/g, '\n'); // Netlify/Vercel يُهرّب \n

  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID   ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey,
    }),
  });
}

const app: App = initAdmin();

export const adminAuth: Auth       = getAuth(app);
export const adminDb:   Firestore  = getFirestore(app);
export { FieldValue };
