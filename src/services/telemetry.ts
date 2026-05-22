// src/services/telemetry.ts
// Flat, unified telemetry logger
//
// Output targets (configurable via ENV):
//   1. Firestore  /tenants/{tid}/logs/{id}   — always (source of truth)
//   2. Upstash    sorted set (score=timestamp) — fast dashboard queries
//   3. stdout JSON — picked up by Vercel/Netlify log drains → Datadog / Logtail
//
// Retention:
//   Firestore: TTL policy set in Firebase Console → 90 days for info, 30 for debug
//   Upstash:   ZREMRANGEBYSCORE cleans entries older than 30 days (called in cron)
//   Log drain: managed by drain provider (Datadog 30d, Logtail 30d default)
//
// All writes are fire-and-forget (void return) — never block request path.

import { adminDb, FieldValue } from '@/lib/firebase-admin';
import { getRedis }            from '@/lib/upstash-client';

// ═════════════════════════════════════════════════════════
//  LOG LEVEL
// ═════════════════════════════════════════════════════════
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Retention days per level — set as Firestore TTL field
const RETENTION_DAYS: Record<LogLevel, number> = {
  debug: 7,
  info:  90,
  warn:  90,
  error: 90,
};

// ═════════════════════════════════════════════════════════
//  EVENT TAXONOMY — flat discriminated union
//  Every event has: level, category, action, tenantId, ts
//  Plus a strongly-typed `data` payload per event type.
// ═════════════════════════════════════════════════════════

// ── Auth events ───────────────────────────────────────────
interface AuthEvent {
  category: 'auth';
  action:
    | 'register.success'
    | 'register.fail'
    | 'login.success'
    | 'login.fail'
    | 'login.blocked'   // brute force lockout
    | 'logout'
    | 'token.verify.fail'
    | 'password.reset';
  data: {
    uid?:   string;
    email?: string;
    reason?: string;    // fail reason
    ip:     string;
  };
}

// ── Order / Payment events ────────────────────────────────
interface OrderEvent {
  category: 'order';
  action:
    | 'created'
    | 'paid'
    | 'refunded'
    | 'failed'
    | 'coupon.applied'
    | 'coupon.invalid';
  data: {
    orderId:    string;
    uid?:       string;
    email?:     string;
    total?:     number;
    currency?:  string;
    couponCode?: string;
    reason?:    string;
    ip:         string;
  };
}

// ── Asset events ──────────────────────────────────────────
interface AssetEvent {
  category: 'asset';
  action:
    | 'upload.success'
    | 'upload.fail'
    | 'serve.success'
    | 'serve.denied'
    | 'token.issued'
    | 'token.used'
    | 'token.expired'
    | 'token.blacklisted';
  data: {
    assetId?:   string;
    publicId?:  string;
    assetType?: string;
    uid?:       string;
    sizeBytes?: number;
    reason?:    string;
    ip:         string;
  };
}

// ── Rate limit events ─────────────────────────────────────
interface RateLimitEvent {
  category: 'ratelimit';
  action:   'blocked' | 'warned';
  data: {
    route:    string;
    esns:     string;   // hashed fingerprint — never raw IP
    ip:       string;
    cost:     number;
  };
}

// ── Content / Read events ─────────────────────────────────
interface ContentEvent {
  category: 'content';
  action:
    | 'book.opened'
    | 'book.progress'
    | 'video.play'
    | 'video.complete'
    | 'chat.message';
  data: {
    uid:      string;
    bookId?:  number;
    videoId?: string;
    progress?: number;  // 0-100
    roomId?:  string;
    ip:       string;
  };
}

// ── System / Error events ─────────────────────────────────
interface SystemEvent {
  category: 'system';
  action:
    | 'startup'
    | 'firestore.error'
    | 'cloudinary.error'
    | 'stripe.error'
    | 'livekit.error'
    | 'upstash.error'
    | 'unhandled.error'
    | 'csp.violation';
  data: {
    message:  string;
    stack?:   string;
    route?:   string;
    code?:    string;
    ip?:      string;
  };
}

// ── Admin events ──────────────────────────────────────────
interface AdminEvent {
  category: 'admin';
  action:
    | 'login'
    | 'product.update'
    | 'order.mark_paid'
    | 'asset.delete'
    | 'coupon.create'
    | 'coupon.delete'
    | 'user.grant_book'
    | 'config.save';
  data: {
    uid:       string;
    target?:   string;   // ID of affected resource
    changes?:  Record<string, unknown>;
    ip:        string;
  };
}

// ── LiveKit events ────────────────────────────────────────
interface LiveKitEvent {
  category: 'livekit';
  action:
    | 'token.issued'
    | 'room.joined'
    | 'room.left'
    | 'room.denied';
  data: {
    uid:       string;
    roomName:  string;
    roomType:  string;
    level:     string;
    ip:        string;
    reason?:   string;
  };
}

// Discriminated union of all event types
type TelemetryEvent =
  | AuthEvent
  | OrderEvent
  | AssetEvent
  | RateLimitEvent
  | ContentEvent
  | SystemEvent
  | AdminEvent
  | LiveKitEvent;

// ═════════════════════════════════════════════════════════
//  LOG RECORD — the actual JSON written everywhere
// ═════════════════════════════════════════════════════════
export interface LogRecord {
  // Identity
  logId:     string;        // auto (Firestore doc ID or crypto.randomUUID)
  tenantId:  string;
  level:     LogLevel;
  // Event
  category:  string;
  action:    string;
  data:      Record<string, unknown>;
  // Time
  ts:        number;        // Unix ms — sortable, drain-compatible
  tsIso:     string;        // ISO 8601 for human readability in logs
  // Retention
  expiresAt: number;        // Unix ms — used by Firestore TTL policy
  // Context
  env:       string;        // 'production' | 'preview' | 'development'
  version:   string;        // NEXT_PUBLIC_APP_VERSION or 'unknown'
}

// ═════════════════════════════════════════════════════════
//  TELEMETRY WRITER
// ═════════════════════════════════════════════════════════
class Telemetry {
  private env:     string;
  private version: string;

  constructor() {
    this.env     = process.env.NODE_ENV ?? 'development';
    this.version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';
  }

  // ── Main write method ──────────────────────────────────
  // Fire-and-forget. Never throws. Never awaited on hot path.
  write(
    tenantId: string,
    level:    LogLevel,
    event:    TelemetryEvent,
  ): void {
    const now    = Date.now();
    const retMs  = RETENTION_DAYS[level] * 86_400_000;
    const record: LogRecord = {
      logId:     crypto.randomUUID(),
      tenantId,
      level,
      category:  event.category,
      action:    event.action,
      data:      event.data as Record<string, unknown>,
      ts:        now,
      tsIso:     new Date(now).toISOString(),
      expiresAt: now + retMs,
      env:       this.env,
      version:   this.version,
    };

    // Skip debug in production
    if (level === 'debug' && this.env === 'production') return;

    // 1. stdout JSON — picked up by log drain
    this.toStdout(record);

    // 2. Firestore + Upstash (server-side only)
    if (typeof window === 'undefined') {
      this.toFirestore(tenantId, record);
      this.toUpstash(tenantId, record);
    }
  }

  // ── Convenience shortcuts ──────────────────────────────
  info (tid: string, e: TelemetryEvent) { this.write(tid, 'info',  e); }
  warn (tid: string, e: TelemetryEvent) { this.write(tid, 'warn',  e); }
  error(tid: string, e: TelemetryEvent) { this.write(tid, 'error', e); }
  debug(tid: string, e: TelemetryEvent) { this.write(tid, 'debug', e); }

  // ── stdout JSON (Vercel/Netlify → log drain) ───────────
  private toStdout(r: LogRecord): void {
    const line = JSON.stringify({
      ts:       r.tsIso,
      level:    r.level,
      tenant:   r.tenantId,
      cat:      r.category,
      action:   r.action,
      ...r.data,
      env:      r.env,
      v:        r.version,
    });
    // Use appropriate console level for drain severity routing
    if (r.level === 'error') console.error(line);
    else if (r.level === 'warn') console.warn(line);
    else console.log(line);
  }

  // ── Firestore (30-90d TTL via expiresAt field) ─────────
  private toFirestore(tenantId: string, r: LogRecord): void {
    adminDb
      .collection(`tenants/${tenantId}/logs`)
      .add({
        ...r,
        // Store expiresAt as Firestore Timestamp for native TTL policy
        expiresAt: new Date(r.expiresAt),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((e: Error) => console.error('[telemetry:firestore]', e.message));
  }

  // ── Upstash sorted set (score = ts, member = JSON) ─────
  // Key: logs:{tenantId}:{category}
  // Enables fast range queries for dashboards without Firestore indexes
  private toUpstash(tenantId: string, r: LogRecord): void {
    const key     = `logs:${tenantId}:${r.category}`;
    const member  = JSON.stringify({
      id: r.logId, ts: r.ts, action: r.action, level: r.level,
      data: r.data,
    });
    getRedis()
      .zadd(key, { score: r.ts, member })
      .then(() => {
        // Trim to 10k entries per category key (rolling window)
        return getRedis().zremrangebyrank(key, 0, -10001);
      })
      .catch((e: Error) => console.error('[telemetry:upstash]', e.message));
  }

  // ── Dashboard query helper ─────────────────────────────
  // Returns log entries for a category in a time range
  async query(opts: {
    tenantId: string;
    category: string;
    fromMs:   number;
    toMs?:    number;
    limit?:   number;
  }): Promise<LogRecord[]> {
    const key    = `logs:${opts.tenantId}:${opts.category}`;
    const to     = opts.toMs ?? Date.now();
    const lim    = opts.limit ?? 200;

    try {
      const raw = await getRedis().zrangebyscore(
        key, opts.fromMs, to, { withScores: false, limit: { offset: 0, count: lim } }
      );
      return (raw as string[])
        .map(r => { try { return JSON.parse(r); } catch { return null; } })
        .filter(Boolean) as LogRecord[];
    } catch {
      // Fallback to Firestore if Upstash unavailable
      const snap = await adminDb
        .collection(`tenants/${opts.tenantId}/logs`)
        .where('category', '==', opts.category)
        .where('ts', '>=', opts.fromMs)
        .where('ts', '<=', to)
        .orderBy('ts', 'desc')
        .limit(lim)
        .get();
      return snap.docs.map(d => d.data() as LogRecord);
    }
  }

  // ── CSP violation ingestion ────────────────────────────
  // Called by /api/csp-report endpoint
  logCspViolation(tenantId: string, report: unknown, ip: string): void {
    const r = report as Record<string, unknown>;
    this.error(tenantId, {
      category: 'system',
      action:   'csp.violation',
      data: {
        message:  String(r['blocked-uri'] ?? r['blockedURI'] ?? 'unknown'),
        route:    String(r['document-uri'] ?? r['documentURI'] ?? ''),
        code:     String(r['violated-directive'] ?? ''),
        ip,
      },
    });
  }
}

// Singleton export
export const log = new Telemetry();

// ── Cron cleanup helper (call from /api/cron/cleanup) ─────
// Removes Upstash entries older than retentionDays
export async function cleanUpstashLogs(
  tenantId:      string,
  categories:    string[],
  retentionDays: number = 30,
): Promise<void> {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  await Promise.all(
    categories.map(cat =>
      getRedis()
        .zremrangebyscore(`logs:${tenantId}:${cat}`, 0, cutoff)
        .catch(() => {})
    )
  );
}
