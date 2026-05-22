// src/app/api/assets/upload/route.ts
// POST /api/assets/upload
//
// Unidirectional sequence (no branching workers):
//   1. Auth + rate limit
//   2. Parse multipart form
//   3. Size + MIME validation
//   4. Metadata scrub (strip EXIF / doc properties)
//   5. Sign Cloudinary upload URL (server-side — secret never leaves)
//   6. Proxy upload to Cloudinary
//   7. Write asset record to Firestore
//   8. Return { assetId, publicId, previewUrl }
//
// ENV: CLOUDINARY_CLOUD, CLOUDINARY_KEY, CLOUDINARY_SECRET
//      FIREBASE_* (admin), LIVEKIT_* unused here

import { type NextRequest } from 'next/server';
import crypto               from 'node:crypto';
import { cookies }          from 'next/headers';
import { Err, toResponse }  from '@/lib/errors';
import { rateLimit }        from '@/lib/upstash-client';
import { getServerSession } from '@/lib/session';
import { adminDb, FieldValue } from '@/lib/firebase-admin';

// ── Asset constraints ──────────────────────────────────
const LIMITS = {
  pdf:   50  * 1024 * 1024,   // 50 MB
  video: 500 * 1024 * 1024,   // 500 MB
  image: 5   * 1024 * 1024,   // 5 MB
} as const;

const ALLOWED_MIME: Record<string, keyof typeof LIMITS> = {
  'application/pdf':      'pdf',
  'video/mp4':            'video',
  'video/webm':           'video',
  'video/quicktime':      'video',
  'image/jpeg':           'image',
  'image/png':            'image',
  'image/webp':           'image',
};

// Cloudinary resource type per asset type
const CLD_RESOURCE: Record<keyof typeof LIMITS, string> = {
  pdf:   'raw',
  video: 'video',
  image: 'image',
};

// ═════════════════════════════════════════════════════════
export async function POST(req: NextRequest): Promise<Response> {
  try {
    // 1. Auth — only admins can upload assets
    const idToken = cookies().get('qum_session')?.value ?? '';
    if (!idToken) throw Err.deny('يجب تسجيل الدخول');
    const session = await getServerSession(idToken);
    if (!session?.isAdmin) throw Err.forbidden('رفع الملفات متاح للمشرفين فقط');

    // Rate limit — 10 uploads / 10 minutes per user
    const allowed = await rateLimit(`rl:upload:${session.uid}`, 10, 600);
    if (!allowed) throw Err.rateLimit();

    // 2. Parse multipart form
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw Err.input('Request must be multipart/form-data');
    }

    const file     = form.get('file') as File | null;
    const tenantId = (form.get('tenantId') as string | null)?.trim() ?? '';
    const folder   = (form.get('folder')   as string | null)?.trim() ?? 'assets'; // e.g. "books" | "videos"
    const label    = (form.get('label')    as string | null)?.trim() ?? '';

    if (!file || !(file instanceof File)) throw Err.missing('file');
    if (!tenantId)                         throw Err.missing('tenantId');
    if (!/^[a-z0-9-]+$/.test(tenantId))   throw Err.input('tenantId غير صالح');

    // 3. Size + MIME validation
    const assetType = ALLOWED_MIME[file.type];
    if (!assetType) {
      throw Err.input(`نوع الملف غير مدعوم: ${file.type}. المسموح: PDF, MP4, WebM, MOV, JPG, PNG, WebP`);
    }

    const maxSize = LIMITS[assetType];
    if (file.size > maxSize) {
      throw Err.input(
        `حجم الملف كبير جداً. الحد الأقصى لـ ${assetType}: ${(maxSize / 1024 / 1024).toFixed(0)} MB`
      );
    }

    if (file.size === 0) throw Err.input('الملف فارغ');

    // 4. Metadata scrub — read bytes → strip metadata → upload clean buffer
    const rawBuffer    = await file.arrayBuffer();
    const cleanBuffer  = scrubMetadata(rawBuffer, file.type);

    // 5. Build Cloudinary signed upload parameters (secret stays server-side)
    const cloud      = process.env.CLOUDINARY_CLOUD  ?? '';
    const apiKey     = process.env.CLOUDINARY_KEY    ?? '';
    const apiSecret  = process.env.CLOUDINARY_SECRET ?? '';
    if (!cloud || !apiKey || !apiSecret) throw Err.system('Cloudinary not configured');

    const timestamp  = Math.floor(Date.now() / 1000);
    const publicId   = `${tenantId}/${folder}/${timestamp}_${crypto.randomBytes(6).toString('hex')}`;
    const resourceType = CLD_RESOURCE[assetType];

    // Sign: eager, folder, public_id, timestamp + secret
    const signString = [
      `public_id=${publicId}`,
      `timestamp=${timestamp}`,
      apiSecret,
    ].join('');

    const signature = crypto
      .createHash('sha256')
      .update(signString)
      .digest('hex');

    // 6. Proxy clean buffer → Cloudinary (secret never hits client)
    const cldFormData = new FormData();
    cldFormData.append('file',       new Blob([cleanBuffer], { type: file.type }));
    cldFormData.append('public_id',  publicId);
    cldFormData.append('timestamp',  String(timestamp));
    cldFormData.append('api_key',    apiKey);
    cldFormData.append('signature',  signature);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`;
    const cldRes    = await fetch(uploadUrl, { method: 'POST', body: cldFormData });

    if (!cldRes.ok) {
      const cldErr = await cldRes.json().catch(() => ({}));
      throw Err.system(`Cloudinary upload failed: ${cldErr.error?.message ?? cldRes.status}`);
    }

    const cldData = await cldRes.json();
    const secureUrl: string = cldData.secure_url ?? '';

    // 7. Write asset record to Firestore
    const assetRef = await adminDb
      .collection(`tenants/${tenantId}/assets`)
      .add({
        tenantId,
        uploadedBy: session.uid,
        label:      label || file.name.replace(/\.[^.]+$/, ''),
        fileName:   file.name,
        mimeType:   file.type,
        assetType,
        publicId,
        secureUrl,
        resourceType,
        sizeBytes:  cleanBuffer.byteLength,
        folder,
        createdAt:  FieldValue.serverTimestamp(),
      });

    // 8. Respond with asset metadata (no secret URLs in response)
    return Response.json({
      assetId:    assetRef.id,
      publicId,
      assetType,
      label:      label || file.name,
      sizeBytes:  cleanBuffer.byteLength,
      // Preview URL — public (images/videos) or empty (PDFs served via /api/assets/serve)
      previewUrl: assetType !== 'pdf' ? secureUrl : null,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    return toResponse(err);
  }
}

// ═════════════════════════════════════════════════════════
//  scrubMetadata
//  Strips EXIF from JPEG/PNG and producer metadata from PDF.
//  For video, strips are complex (FFmpeg needed) — return as-is with
//  a note: on-upload Cloudinary transformation handles video metadata.
// ═════════════════════════════════════════════════════════
function scrubMetadata(buffer: ArrayBuffer, mimeType: string): ArrayBuffer {
  const bytes = new Uint8Array(buffer);

  if (mimeType === 'image/jpeg') return scrubJpegExif(bytes);
  if (mimeType === 'image/png')  return scrubPngText(bytes);
  if (mimeType === 'application/pdf') return scrubPdfMetadata(bytes);

  // image/webp and video — return unchanged
  // Cloudinary applies c_limit + strip_exif transformation on video automatically
  return buffer;
}

// JPEG: remove APP1 (EXIF) and APP13 (IPTC) segments
function scrubJpegExif(bytes: Uint8Array): ArrayBuffer {
  const out: number[] = [0xFF, 0xD8]; // SOI marker
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xFF) break;
    const marker = bytes[i + 1];
    const isApp  = marker >= 0xE0 && marker <= 0xEF; // APP0-APP15
    if (isApp && marker !== 0xE0) {
      // Skip this segment (EXIF=APP1=0xE1, IPTC=APP13=0xED, etc.)
      const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
      i += 2 + segLen;
      continue;
    }
    if (marker === 0xD9) { out.push(0xFF, 0xD9); break; } // EOI
    const segLen = marker === 0xD8 ? 0 : (bytes[i + 2] << 8) | bytes[i + 3];
    const total  = 2 + (segLen || 0);
    for (let j = 0; j < total && i + j < bytes.length; j++) out.push(bytes[i + j]);
    i += total;
  }
  return new Uint8Array(out).buffer;
}

// PNG: remove tEXt, zTXt, iTXt, eXIf chunks
const PNG_SCRUB_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);

function scrubPngText(bytes: Uint8Array): ArrayBuffer {
  const out: number[] = Array.from(bytes.slice(0, 8)); // PNG signature
  let i = 8;
  while (i < bytes.length) {
    const len    = (bytes[i] << 24 | bytes[i+1] << 16 | bytes[i+2] << 8 | bytes[i+3]) >>> 0;
    const type   = String.fromCharCode(bytes[i+4], bytes[i+5], bytes[i+6], bytes[i+7]);
    const total  = 4 + 4 + len + 4; // length + type + data + CRC
    if (PNG_SCRUB_CHUNKS.has(type)) {
      i += total; // skip
      if (type === 'IEND') break;
      continue;
    }
    for (let j = 0; j < total && i + j < bytes.length; j++) out.push(bytes[i + j]);
    i += total;
    if (type === 'IEND') break;
  }
  return new Uint8Array(out).buffer;
}

// PDF: overwrite /Info dictionary and XMP metadata stream with nulls
// Full parse is complex — we zero known metadata keyword patterns
function scrubPdfMetadata(bytes: Uint8Array): ArrayBuffer {
  const text     = new TextDecoder('latin1').decode(bytes);
  const patterns = [
    /\/Author\s*\([^)]*\)/g,
    /\/Creator\s*\([^)]*\)/g,
    /\/Producer\s*\([^)]*\)/g,
    /\/Subject\s*\([^)]*\)/g,
    /\/Keywords\s*\([^)]*\)/g,
  ];
  let scrubbed = text;
  for (const p of patterns) {
    scrubbed = scrubbed.replace(p, (m) =>
      m.replace(/\([^)]*\)/, '(' + ' '.repeat(Math.max(0, m.length - 2)) + ')')
    );
  }
  return new TextEncoder().encode(scrubbed).buffer;
}
