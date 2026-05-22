'use client';
// src/hooks/useChatFeed.ts
// Firestore real-time subscription → windowed message buffer
// Sequential: onSnapshot fires → append to buffer → trim to MAX_MSGS → re-render
// No polling. No WebSocket wiring here. No event bus.

import { useEffect, useReducer, useRef, useCallback } from 'react';
import {
  collection, query, orderBy, limit,
  onSnapshot, addDoc, serverTimestamp,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { clientDb } from '@/lib/firebase-client';

// ── Public types ───────────────────────────────────────────
export type StudentLevel = 'starter' | 'reader' | 'scholar' | 'mentor';

export interface ChatMessage {
  id:        string;
  uid:       string;
  name:      string;
  text:      string;
  level:     StudentLevel;
  booksRead: number;    // total purchased books — drives badge
  createdAt: number;    // ms timestamp — safe to serialize
  pending?:  boolean;   // optimistic UI
}

interface State {
  messages: ChatMessage[];
  status:   'idle' | 'loading' | 'live' | 'error';
  error:    string | null;
}

type Action =
  | { type: 'LOADING' }
  | { type: 'LIVE'; messages: ChatMessage[] }
  | { type: 'APPEND'; messages: ChatMessage[] }
  | { type: 'OPTIMISTIC'; msg: ChatMessage }
  | { type: 'CONFIRM'; tmpId: string; confirmed: ChatMessage }
  | { type: 'ERROR'; error: string };

const MAX_MSGS = 150; // keep last N messages in memory

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOADING': return { ...state, status: 'loading', error: null };

    case 'LIVE': return {
      status:   'live',
      error:    null,
      messages: action.messages.slice(-MAX_MSGS),
    };

    case 'APPEND': {
      const ids  = new Set(state.messages.map(m => m.id));
      const next = action.messages.filter(m => !ids.has(m.id));
      const merged = [...state.messages, ...next].slice(-MAX_MSGS);
      return { ...state, status: 'live', messages: merged };
    }

    case 'OPTIMISTIC': return {
      ...state,
      messages: [...state.messages, action.msg].slice(-MAX_MSGS),
    };

    case 'CONFIRM': {
      // Replace pending optimistic msg with confirmed Firestore doc
      const msgs = state.messages.map(m =>
        m.id === action.tmpId ? action.confirmed : m,
      );
      return { ...state, messages: msgs };
    }

    case 'ERROR': return { ...state, status: 'error', error: action.error };
    default: return state;
  }
}

// ═════════════════════════════════════════════════════════
//  useChatFeed
// ═════════════════════════════════════════════════════════
export function useChatFeed(
  tenantId: string,
  roomId:   string,
  options?: { initialLimit?: number },
) {
  const [state, dispatch] = useReducer(reducer, {
    messages: [],
    status:   'idle',
    error:    null,
  });

  const unsubRef    = useRef<(() => void) | null>(null);
  const initialLoad = useRef(true);
  const initLimit   = options?.initialLimit ?? 50;

  // Firestore path: /tenants/{tenantId}/community_chat/{roomId}/messages
  const msgPath = `tenants/${tenantId}/community_chat/${roomId}/messages`;

  useEffect(() => {
    if (!tenantId || !roomId) return;
    dispatch({ type: 'LOADING' });
    initialLoad.current = true;

    const q = query(
      collection(clientDb, msgPath),
      orderBy('createdAt', 'asc'),
      limit(initLimit),
    );

    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: false },
      (snap) => {
        const msgs: ChatMessage[] = snap.docs.map(docToMessage);

        if (initialLoad.current) {
          // First load: replace all
          dispatch({ type: 'LIVE', messages: msgs });
          initialLoad.current = false;
        } else {
          // Subsequent: only add new docs
          const newDocs = snap.docChanges()
            .filter(c => c.type === 'added')
            .map(c => docToMessage(c.doc));
          if (newDocs.length) dispatch({ type: 'APPEND', messages: newDocs });
        }
      },
      (err) => {
        console.error('[chat] onSnapshot error:', err.message);
        dispatch({ type: 'ERROR', error: 'فشل الاتصال — حاول مجدداً' });
      },
    );

    unsubRef.current = unsub;
    return () => { unsub(); unsubRef.current = null; };
  }, [tenantId, roomId, msgPath, initLimit]);

  // ── Send message: optimistic → Firestore write ────────
  const sendMessage = useCallback(async (
    text:      string,
    sender: {
      uid:       string;
      name:      string;
      level:     StudentLevel;
      booksRead: number;
    },
  ) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 1000) return;

    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id:        tmpId,
      uid:       sender.uid,
      name:      sender.name,
      text:      trimmed,
      level:     sender.level,
      booksRead: sender.booksRead,
      createdAt: Date.now(),
      pending:   true,
    };

    // Show immediately (optimistic)
    dispatch({ type: 'OPTIMISTIC', msg: optimistic });

    // Write to Firestore
    try {
      const ref = await addDoc(collection(clientDb, msgPath), {
        uid:       sender.uid,
        name:      sender.name,
        text:      trimmed,
        level:     sender.level,
        booksRead: sender.booksRead,
        createdAt: serverTimestamp(),
      });

      // Confirm optimistic with real ID
      dispatch({
        type: 'CONFIRM',
        tmpId,
        confirmed: { ...optimistic, id: ref.id, pending: false },
      });
    } catch (err) {
      console.error('[chat] sendMessage error:', err);
      // Remove failed optimistic message
      dispatch({
        type:    'LIVE',
        messages: state.messages.filter(m => m.id !== tmpId),
      });
    }
  }, [msgPath, state.messages]);

  return { ...state, sendMessage };
}

// ── Map Firestore doc → ChatMessage ──────────────────────
function docToMessage(snap: QueryDocumentSnapshot<DocumentData>): ChatMessage {
  const d = snap.data();
  return {
    id:        snap.id,
    uid:       d.uid        ?? '',
    name:      d.name       ?? 'مجهول',
    text:      d.text       ?? '',
    level:     (d.level     ?? 'starter') as StudentLevel,
    booksRead: d.booksRead  ?? 0,
    // Convert Firestore Timestamp → ms safely
    createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
    pending:   false,
  };
}

// ── Derive level from booksRead (used when writing a message) ──
export function deriveLevel(booksRead: number): StudentLevel {
  if (booksRead >= 10) return 'mentor';
  if (booksRead >= 5)  return 'scholar';
  if (booksRead >= 2)  return 'reader';
  return 'starter';
}
