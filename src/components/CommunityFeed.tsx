'use client';
// src/components/CommunityFeed.tsx
// Virtualized real-time chat feed
//
// Architecture:
//   useChatFeed (Firestore onSnapshot) → reducer → render
//   Virtualization: CSS content-visibility + manual overscan window
//   CLS guards: fixed-height rows, avatar placeholders, skeleton rail
//
// Badge system (booksRead → level → badge):
//   0-1   starter   → 📖 مبتدئ
//   2-4   reader    → 📚 قارئ
//   5-9   scholar   → 🎓 متعلم
//   10+   mentor    → 🏆 مرشد

import {
  useRef, useEffect, useState,
  useCallback, useMemo,
  type KeyboardEvent,
}                        from 'react';
import {
  useChatFeed, deriveLevel,
  type ChatMessage, type StudentLevel,
}                        from '@/hooks/useChatFeed';
import { useQum }        from '@/components/Providers';

// ── Badge config ─────────────────────────────────────────
const LEVEL_BADGE: Record<StudentLevel, {
  label:   string;
  emoji:   string;
  classes: string; // Tailwind
}> = {
  starter: {
    label:   'مبتدئ',
    emoji:   '📖',
    classes: 'bg-slate-500/20 border-slate-500/30 text-slate-300',
  },
  reader: {
    label:   'قارئ',
    emoji:   '📚',
    classes: 'bg-blue-500/20 border-blue-500/30 text-blue-300',
  },
  scholar: {
    label:   'متعلم',
    emoji:   '🎓',
    classes: 'bg-purple-500/20 border-purple-500/30 text-purple-300',
  },
  mentor: {
    label:   'مرشد',
    emoji:   '🏆',
    classes: 'bg-amber-500/20 border-amber-500/35 text-amber-300',
  },
};

const AVATAR_COLORS: Record<StudentLevel, string> = {
  starter: 'from-slate-600 to-slate-500',
  reader:  'from-blue-700 to-blue-500',
  scholar: 'from-purple-700 to-purple-500',
  mentor:  'from-amber-600 to-amber-400',
};

// Row height — fixed to eliminate CLS during virtual scroll
const ROW_MIN_H = 72; // px — enough for one-liner; multi-line expands naturally

// ══════════════════════════════════════════════════════════
interface Props {
  tenantId:    string;
  roomId:      string;
  roomTitle?:  string;
  className?:  string;
}

// ═════════════════════════════════════════════════════════
//  ROOT
// ═════════════════════════════════════════════════════════
export function CommunityFeed({ tenantId, roomId, roomTitle = 'المجتمع', className = '' }: Props) {
  const { user, toast } = useQum();
  const {
    messages, status, error, sendMessage,
  } = useChatFeed(tenantId, roomId);

  const [input, setInput]         = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef                 = useRef<HTMLDivElement>(null);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLTextAreaElement>(null);

  // ── Auto-scroll when new messages arrive ─────────────
  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, autoScroll]);

  // ── Detect manual scroll-up → pause auto-scroll ──────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distFromBottom < 80);
  }, []);

  // ── Send ──────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!user) { toast('🔐 سجّل دخولك للمشاركة', 'err'); return; }
    const text = input.trim();
    if (!text) return;
    if (text.length > 1000) { toast('⚠️ الرسالة طويلة جداً (أقل من 1000 حرف)', 'err'); return; }
    setInput('');
    await sendMessage(text, {
      uid:       user.uid,
      name:      user.name,
      level:     deriveLevel(user.purchasedBooks.length),
      booksRead: user.purchasedBooks.length,
    });
  }, [user, input, sendMessage, toast]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // ── Unread counter (messages arrived while scrolled up) ──
  const [unread, setUnread] = useState(0);
  const prevCount           = useRef(0);
  useEffect(() => {
    if (!autoScroll && messages.length > prevCount.current) {
      setUnread(n => n + (messages.length - prevCount.current));
    }
    if (autoScroll) setUnread(0);
    prevCount.current = messages.length;
  }, [messages.length, autoScroll]);

  return (
    <section
      aria-label={roomTitle}
      className={[
        'flex flex-col rounded-2xl border border-white/8 bg-dark2 overflow-hidden',
        'h-[600px] md:h-[680px]',   // fixed height — zero CLS
        className,
      ].join(' ')}
    >
      {/* Header */}
      <RoomHeader
        title={roomTitle}
        status={status}
        memberCount={useMemo(() =>
          new Set(messages.map(m => m.uid)).size, [messages])}
      />

      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="رسائل المجتمع"
        aria-atomic="false"
        className="flex-1 overflow-y-auto overscroll-contain
          scroll-smooth px-3 py-3 space-y-0.5
          scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
      >
        {status === 'loading' && <MessageSkeleton rows={6} />}
        {status === 'error'   && <ErrorState message={error ?? 'خطأ غير معروف'} />}
        {status === 'live'    && messages.length === 0 && <EmptyState />}
        {status === 'live'    && messages.map((msg, i) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            isSelf={msg.uid === user?.uid}
            showAvatar={shouldShowAvatar(messages, i)}
          />
        ))}
        {/* Scroll anchor — div at bottom for scrollIntoView */}
        <div ref={bottomRef} aria-hidden className="h-1" />
      </div>

      {/* Jump-to-bottom pill */}
      {!autoScroll && (
        <button
          onClick={() => { setAutoScroll(true); setUnread(0); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
          aria-label={`${unread} رسائل جديدة — انتقل للأسفل`}
          className="absolute bottom-[72px] left-1/2 -translate-x-1/2
            flex items-center gap-2 px-4 py-1.5 rounded-full
            bg-blue-600 text-white text-xs font-bold shadow-lg
            hover:bg-blue-500 transition-colors z-10"
        >
          {unread > 0 && (
            <span className="bg-white text-blue-600 rounded-full px-1.5 text-[10px] font-black">
              {unread}
            </span>
          )}
          ↓ أحدث الرسائل
        </button>
      )}

      {/* Input bar */}
      <InputBar
        ref={inputRef}
        value={input}
        onChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        disabled={!user || status !== 'live'}
        placeholder={user ? 'اكتب رسالتك...' : 'سجّل دخولك للمشاركة'}
        userLevel={user ? deriveLevel(user.purchasedBooks.length) : null}
      />
    </section>
  );
}

// ═════════════════════════════════════════════════════════
//  MESSAGE ROW — virtualization hint: content-visibility
// ═════════════════════════════════════════════════════════
function MessageRow({
  msg, isSelf, showAvatar,
}: {
  msg:        ChatMessage;
  isSelf:     boolean;
  showAvatar: boolean;
}) {
  const badge   = LEVEL_BADGE[msg.level];
  const initial = (msg.name || '?')[0].toUpperCase();

  return (
    // content-visibility: auto → browser skips paint for off-screen rows
    // contain-intrinsic-size matches ROW_MIN_H to avoid layout recalc
    <div
      aria-label={`${msg.name}: ${msg.text}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: `0 ${ROW_MIN_H}px` }}
      className={[
        'flex items-end gap-2 group',
        'min-h-[72px] px-1 py-1',
        isSelf ? 'flex-row-reverse' : 'flex-row',
        msg.pending ? 'opacity-60' : 'opacity-100',
      ].join(' ')}
    >
      {/* Avatar — fixed 32×32, prevents CLS */}
      <div
        aria-hidden
        className={[
          'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center',
          'bg-gradient-to-br text-white text-xs font-black select-none',
          AVATAR_COLORS[msg.level],
          showAvatar ? 'visible' : 'invisible', // holds space even when hidden
        ].join(' ')}
      >
        {initial}
      </div>

      {/* Bubble */}
      <div className={['flex flex-col gap-1 max-w-[75%]', isSelf ? 'items-end' : 'items-start'].join(' ')}>
        {/* Name + badge — only on first in group */}
        {showAvatar && (
          <div className={['flex items-center gap-1.5 flex-wrap', isSelf ? 'flex-row-reverse' : ''].join(' ')}>
            <span className="text-white text-xs font-bold leading-none">
              {isSelf ? 'أنت' : msg.name}
            </span>
            {/* Dynamic level badge */}
            <span
              aria-label={`المستوى: ${badge.label}`}
              className={[
                'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full',
                'text-[9px] font-black border',
                badge.classes,
              ].join(' ')}
            >
              <span aria-hidden>{badge.emoji}</span>
              {badge.label}
            </span>
          </div>
        )}

        {/* Message text */}
        <div
          className={[
            'rounded-2xl px-3 py-2 text-sm leading-relaxed break-words',
            'max-w-full',
            isSelf
              ? 'bg-blue-600 text-white rounded-bl-sm'
              : 'bg-dark4 border border-white/8 text-qum-text rounded-br-sm',
          ].join(' ')}
        >
          {msg.text}
          {/* Timestamp — visible on hover */}
          <time
            dateTime={new Date(msg.createdAt).toISOString()}
            className={[
              'block text-[10px] mt-1 opacity-0 group-hover:opacity-60 transition-opacity',
              isSelf ? 'text-blue-200 text-left' : 'text-muted text-right',
            ].join(' ')}
          >
            {formatTime(msg.createdAt)}
          </time>
        </div>

        {/* Pending indicator */}
        {msg.pending && (
          <span aria-live="polite" className="text-muted text-[10px]">جاري الإرسال...</span>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
//  INPUT BAR
// ═════════════════════════════════════════════════════════
import { forwardRef } from 'react';

const InputBar = forwardRef<
  HTMLTextAreaElement,
  {
    value:      string;
    onChange:   (v: string) => void;
    onKeyDown:  (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onSend:     () => void;
    disabled:   boolean;
    placeholder: string;
    userLevel:  StudentLevel | null;
  }
>(function InputBar({ value, onChange, onKeyDown, onSend, disabled, placeholder, userLevel }, ref) {
  const badge = userLevel ? LEVEL_BADGE[userLevel] : null;

  return (
    <div
      className="flex items-end gap-2 px-3 py-3 border-t border-white/8 bg-dark3
        flex-shrink-0" // flex-shrink-0: never compress input bar
    >
      {/* User level badge beside input */}
      {badge && (
        <span
          aria-hidden
          className={[
            'flex-shrink-0 text-xs font-black px-2 py-1 rounded-lg border mb-0.5',
            badge.classes,
          ].join(' ')}
        >
          {badge.emoji}
        </span>
      )}

      {/* Auto-growing textarea */}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={1000}
        aria-label="رسالتك"
        dir="auto"
        className={[
          'flex-1 resize-none rounded-xl bg-dark2 border border-white/10',
          'px-3 py-2.5 text-sm text-white placeholder:text-muted/60',
          'outline-none focus:border-blue-500/50 transition-colors',
          'max-h-28 overflow-y-auto',
          'scrollbar-thin scrollbar-thumb-white/10',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          // Auto-grow via field-sizing (progressive enhancement)
          '[field-sizing:content]',
        ].join(' ')}
        onInput={e => {
          // Fallback auto-grow for browsers without field-sizing
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 112) + 'px';
        }}
      />

      {/* Send button */}
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label="إرسال"
        className={[
          'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center',
          'bg-blue-600 text-white text-base transition-all',
          'hover:bg-blue-500 active:scale-90',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        ].join(' ')}
      >
        ➤
      </button>
    </div>
  );
});

// ═════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═════════════════════════════════════════════════════════
function RoomHeader({
  title, status, memberCount,
}: {
  title: string; status: string; memberCount: number;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8
      flex-shrink-0 bg-dark3">
      <div className="flex items-center gap-2.5">
        <span className="text-lg" aria-hidden>💬</span>
        <div>
          <h2 className="text-white font-bold text-sm leading-none">{title}</h2>
          <p className="text-muted text-[10px] mt-0.5">
            {memberCount > 0 ? `${memberCount} أعضاء نشطون` : 'مجتمع قُم'}
          </p>
        </div>
      </div>
      {/* Live indicator */}
      <div
        aria-label={status === 'live' ? 'متصل' : 'جاري الاتصال'}
        className="flex items-center gap-1.5"
      >
        <span
          className={[
            'w-2 h-2 rounded-full',
            status === 'live'    ? 'bg-green-500 animate-pulse' :
            status === 'loading' ? 'bg-yellow-500 animate-pulse' :
            status === 'error'   ? 'bg-red-500' : 'bg-muted',
          ].join(' ')}
        />
        <span className="text-muted text-[10px] font-semibold">
          {status === 'live' ? 'مباشر' : status === 'loading' ? 'اتصال...' : 'خطأ'}
        </span>
      </div>
    </div>
  );
}

// Skeleton rows — exact h matches ROW_MIN_H for zero CLS
function MessageSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden role="presentation" className="space-y-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`flex items-end gap-2 min-h-[72px] px-1 py-1
          ${i % 3 === 0 ? 'flex-row-reverse' : ''} animate-pulse`}>
          <div className="w-8 h-8 rounded-full bg-white/8 flex-shrink-0" />
          <div className="flex flex-col gap-1.5 max-w-[60%]">
            <div className={`h-3 rounded bg-white/8 ${i % 2 === 0 ? 'w-20' : 'w-14'}`} />
            <div className={`h-9 rounded-2xl bg-white/8 ${i % 3 === 0 ? 'w-48' : 'w-36'}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <span className="text-4xl mb-3" aria-hidden>💬</span>
      <p className="text-white font-bold text-sm mb-1">كن أول من يبدأ الحديث!</p>
      <p className="text-muted text-xs">شارك أفكارك مع مجتمع قُم</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center h-full text-center py-12">
      <span className="text-3xl mb-3" aria-hidden>⚠️</span>
      <p className="text-red-400 text-sm font-semibold">{message}</p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────

// Group: hide avatar/name for consecutive messages from same user (< 2min apart)
function shouldShowAvatar(msgs: ChatMessage[], i: number): boolean {
  if (i === 0) return true;
  const prev = msgs[i - 1];
  const curr = msgs[i];
  if (prev.uid !== curr.uid) return true;
  return curr.createdAt - prev.createdAt > 2 * 60_000;
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit' }).format(ms);
}
