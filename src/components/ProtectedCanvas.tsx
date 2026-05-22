'use client';
// src/components/ProtectedCanvas.tsx
// Canvas-based forensic watermark wrapper
//
// Renders children (PDF viewer, video player, etc.) behind an
// absolutely-positioned canvas overlay that draws:
//   1. Platform_Logo    — "قُم" wordmark repeated in a diagonal grid
//   2. User_ID          — first 8 chars of uid
//   3. Network Sig Hash — ESNS-style hash (uid + date + salt)
//
// Properties:
//   - Opacity: 0.028 — visible under screen capture analysis, invisible to eye
//   - Canvas pointer-events: none — interaction passes through to content
//   - ResizeObserver: re-draws on container resize (no CLS — canvas is absolute)
//   - No server round-trip at render time — all computation is client-side
//   - RequestAnimationFrame-based draw — never blocks main thread

import {
  useRef, useEffect, useCallback,
  type ReactNode,
} from 'react';

interface ProtectedCanvasProps {
  uid:        string;         // Firebase user uid
  tenantId:   string;
  children:   ReactNode;
  className?: string;
  opacity?:   number;         // default 0.028 — forensically visible, perceptually invisible
  gridSize?:  number;         // px between watermark cells (default 220)
  enabled?:   boolean;        // false = renders children without overlay (e.g. in admin preview)
}

// ─────────────────────────────────────────────────────────
//  Derive a 16-char Network Signature Hash
//  Inputs: uid + date (YYYY-MM-DD) + tenantId + browser entropy
//  Purpose: ties screen capture to a specific session day
//  One-way: cannot be reversed without uid + date + tenantId
// ─────────────────────────────────────────────────────────
async function deriveNetworkHash(uid: string, tenantId: string): Promise<string> {
  const today   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const entropy = navigator.userAgent.slice(0, 32);       // non-PII browser signal
  const raw     = `${uid}|${tenantId}|${today}|${entropy}`;

  // Web Crypto subtle — available in all modern browsers
  const encoded = new TextEncoder().encode(raw);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const hex     = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return hex.slice(0, 16).toUpperCase(); // 64-bit — compact, sufficient for forensics
}

// ─────────────────────────────────────────────────────────
//  Draw watermark onto canvas
// ─────────────────────────────────────────────────────────
function drawWatermark(
  canvas:      HTMLCanvasElement,
  lines:       string[],       // text lines to draw per cell
  opacity:     number,
  gridSize:    number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Save state
  ctx.save();

  // Global alpha — perceptually invisible, forensically visible
  ctx.globalAlpha = opacity;

  // Diagonal rotation (-25deg) — matches most screenshot crop patterns
  const ANGLE = -25 * (Math.PI / 180);

  // Font stack — system fonts, no external request
  ctx.font          = '500 11px "SF Pro Text", "Segoe UI", "Cairo", sans-serif';
  ctx.fillStyle     = '#FFFFFF';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';

  // Calculate grid bounds to cover canvas + rotation bleed
  const diag     = Math.hypot(canvas.width, canvas.height);
  const cols     = Math.ceil(diag / gridSize) + 2;
  const rows     = Math.ceil(diag / gridSize) + 2;
  const offsetX  = canvas.width  / 2;
  const offsetY  = canvas.height / 2;

  for (let r = -rows; r <= rows; r++) {
    for (let c = -cols; c <= cols; c++) {
      const x = c * gridSize;
      const y = r * gridSize * 1.4; // 1.4 vertical spread for readability

      ctx.save();
      ctx.translate(offsetX + x, offsetY + y);
      ctx.rotate(ANGLE);

      // Line 0: Platform logo — slightly larger
      ctx.font = '700 13px "SF Pro Text", "Segoe UI", "Cairo", sans-serif';
      ctx.fillText(lines[0] ?? '', 0, -11);

      // Lines 1+: uid + hash — monospace
      ctx.font = '400 10px "SF Mono", "Cascadia Code", monospace';
      for (let li = 1; li < lines.length; li++) {
        ctx.fillText(lines[li] ?? '', 0, li * 13);
      }

      ctx.restore();
    }
  }

  ctx.restore();
}

// ═════════════════════════════════════════════════════════
//  ProtectedCanvas Component
// ═════════════════════════════════════════════════════════
export function ProtectedCanvas({
  uid,
  tenantId,
  children,
  className = '',
  opacity   = 0.028,
  gridSize  = 220,
  enabled   = true,
}: ProtectedCanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const containerRef= useRef<HTMLDivElement>(null);
  const linesRef    = useRef<string[]>([]);
  const rafRef      = useRef<number | null>(null);
  const roRef       = useRef<ResizeObserver | null>(null);

  // Derive watermark lines once per mount
  useEffect(() => {
    if (!enabled || !uid) return;

    const shortUid = uid.slice(0, 8).toUpperCase();

    deriveNetworkHash(uid, tenantId).then(hash => {
      linesRef.current = [
        'قُم',                          // Platform_Logo
        `UID: ${shortUid}`,             // User_ID
        `NET: ${hash.slice(0, 8)} ${hash.slice(8)}`, // Network Sig (split for readability)
      ];
      scheduleDraw();
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      roRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, tenantId, enabled]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container || !linesRef.current.length) return;

      // Sync canvas resolution to container (device pixel ratio aware)
      const dpr = window.devicePixelRatio || 1;
      const w   = container.offsetWidth;
      const h   = container.offsetHeight;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width  = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        ctx?.scale(dpr, dpr);
      }

      drawWatermark(canvas, linesRef.current, opacity, gridSize);
    });
  }, [opacity, gridSize]);

  // ResizeObserver — re-draw when container resizes
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    roRef.current = new ResizeObserver(() => scheduleDraw());
    roRef.current.observe(container);
    return () => roRef.current?.disconnect();
  }, [enabled, scheduleDraw]);

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={['relative', className].join(' ')}
    >
      {/* Content layer — full z-0 */}
      <div className="relative z-0">{children}</div>

      {/* Watermark canvas — absolutely positioned, no pointer events */}
      <canvas
        ref={canvasRef}
        aria-hidden
        role="presentation"
        style={{
          position:       'absolute',
          inset:          0,
          pointerEvents:  'none',    // clicks pass through
          userSelect:     'none',
          zIndex:         10,
          mixBlendMode:   'screen',  // subtle blend — reduces perceptual visibility
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  Convenience hook — returns watermark lines for external use
//  (e.g. embedding in PDF page metadata before streaming)
// ─────────────────────────────────────────────────────────
export function useWatermarkLines(
  uid:      string,
  tenantId: string,
): { lines: string[]; ready: boolean } {
  const linesRef = useRef<string[]>([]);
  const readyRef = useRef(false);
  const [, forceUpdate] = useRef(0) as any;

  useEffect(() => {
    if (!uid) return;
    const shortUid = uid.slice(0, 8).toUpperCase();
    deriveNetworkHash(uid, tenantId).then(hash => {
      linesRef.current = [
        'قُم',
        `UID:${shortUid}`,
        `NET:${hash}`,
      ];
      readyRef.current = true;
      forceUpdate((n: number) => n + 1); // trigger re-render
    });
  }, [uid, tenantId]);

  return { lines: linesRef.current, ready: readyRef.current };
}
