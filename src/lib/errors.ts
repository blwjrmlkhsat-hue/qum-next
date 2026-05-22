// src/lib/errors.ts
// Flat error taxonomy — 3 types only, no inheritance chains
// Every thrown error in the app maps to one of these.
// Route Handlers catch ApiError → toResponse()

export type ErrorCode =
  // Input
  | 'invalid_input'      // Zod validation failed
  | 'missing_field'      // required field absent
  // Security
  | 'security_deny'      // auth missing, token invalid, access forbidden
  | 'rate_limited'       // too many requests
  | 'coupon_invalid'     // coupon expired / not found / exhausted
  // Business
  | 'product_not_found'  // product ID doesn't exist or inactive
  | 'already_purchased'  // user already owns this book
  | 'payment_failed'     // Stripe returned failure
  // System
  | 'system_fail'        // Firestore / Stripe / Cloudinary unreachable
  | 'webhook_invalid';   // Stripe signature mismatch

interface ApiErrorOptions {
  code:    ErrorCode;
  message: string;       // human-readable, shown to client
  status:  number;       // HTTP status
  detail?: unknown;      // internal only — logged, never sent
}

export class ApiError extends Error {
  readonly code:   ErrorCode;
  readonly status: number;
  readonly detail: unknown;

  constructor({ code, message, status, detail }: ApiErrorOptions) {
    super(message);
    this.name   = 'ApiError';
    this.code   = code;
    this.status = status;
    this.detail = detail;
  }
}

// ── Factory shortcuts ─────────────────────────────────────
export const Err = {
  input   : (msg: string, detail?: unknown) =>
    new ApiError({ code: 'invalid_input',   status: 422, message: msg, detail }),

  missing : (field: string) =>
    new ApiError({ code: 'missing_field',   status: 422, message: `حقل مطلوب: ${field}` }),

  deny    : (msg = 'غير مصرح') =>
    new ApiError({ code: 'security_deny',   status: 401, message: msg }),

  forbidden: (msg = 'ليس لديك صلاحية') =>
    new ApiError({ code: 'security_deny',   status: 403, message: msg }),

  rateLimit: () =>
    new ApiError({ code: 'rate_limited',    status: 429, message: 'طلبات كثيرة — انتظر دقيقة' }),

  coupon  : (msg: string) =>
    new ApiError({ code: 'coupon_invalid',  status: 400, message: msg }),

  notFound: (what = 'المنتج') =>
    new ApiError({ code: 'product_not_found', status: 404, message: `${what} غير موجود` }),

  purchased: () =>
    new ApiError({ code: 'already_purchased', status: 409, message: 'هذا الكتاب مشترى مسبقاً' }),

  payment : (msg = 'فشل الدفع') =>
    new ApiError({ code: 'payment_failed',  status: 402, message: msg }),

  system  : (detail?: unknown) =>
    new ApiError({ code: 'system_fail',     status: 502, message: 'خطأ في الخادم — حاول مجدداً', detail }),

  webhook : () =>
    new ApiError({ code: 'webhook_invalid', status: 400, message: 'Stripe signature invalid' }),
} as const;

// ── Route Handler catch wrapper ───────────────────────────
// Converts any thrown value → { error, code } JSON + correct HTTP status
export function toResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    // Log internal detail server-side (never exposed to client)
    if (err.detail) console.error(`[${err.code}]`, err.detail);

    return Response.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }

  // Unknown / unexpected — always system_fail
  console.error('[system_fail] Unexpected error:', err);
  return Response.json(
    { error: 'خطأ داخلي في الخادم', code: 'system_fail' },
    { status: 500 }
  );
}
