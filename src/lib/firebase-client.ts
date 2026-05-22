// src/lib/firebase-client.ts
// Singleton Firebase Client SDK
// يُستخدم فقط من Client Components (Providers, AuthModal, PdfReader...)
// 'use client' ليس مطلوباً هنا — هذا ملف lib عادي

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth,      type Auth }       from 'firebase/auth';
import { getFirestore, type Firestore }  from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY            ?? '',
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN        ?? '',
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID         ?? '',
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET     ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID             ?? '',
};

const clientApp: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

export const clientAuth: Auth      = getAuth(clientApp);
export const clientDb:   Firestore = getFirestore(clientApp);
