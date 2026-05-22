// src/app/api/csp-report/route.ts
// POST /api/csp-report  — receives browser CSP violation reports
// Feeds directly into telemetry.logCspViolation()

import { type NextRequest } from 'next/server';
import { log }              from '@/services/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const ip   = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

    // Report can be nested under "csp-report" key (old spec) or flat (new)
    const report = (body['csp-report'] ?? body) as Record<string, unknown>;

    // Best-effort tenantId from referrer
    const tenantId = extractTenantId(req.headers.get('referer') ?? '');

    log.warn(tenantId, {
      category: 'system',
      action:   'csp.violation',
      data: {
        message:  String(report['blocked-uri'] ?? report['blockedURI'] ?? 'unknown'),
        route:    String(report['document-uri'] ?? report['documentURI'] ?? ''),
        code:     String(report['violated-directive'] ?? report['effectiveDirective'] ?? ''),
        ip,
      },
    });

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 }); // always 204 — never error to browser
  }
}

function extractTenantId(referer: string): string {
  try {
    const url = new URL(referer);
    return url.hostname.split('.')[0] || 'unknown';
  } catch { return 'unknown'; }
}
