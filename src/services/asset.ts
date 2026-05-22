// src/services/asset.ts
// Client-facing asset service — wraps /api/assets/* routes
// Components call these. No Cloudinary secrets here.

export interface UploadResult {
  assetId:    string;
  publicId:   string;
  assetType:  'pdf' | 'video' | 'image';
  label:      string;
  sizeBytes:  number;
  previewUrl: string | null;
}

// ── Upload a file (proxied through our API — never direct to Cloudinary) ──
export async function uploadAsset(
  file:     File,
  tenantId: string,
  options?: { folder?: string; label?: string },
): Promise<UploadResult> {
  const form = new FormData();
  form.append('file',     file);
  form.append('tenantId', tenantId);
  if (options?.folder) form.append('folder', options.folder);
  if (options?.label)  form.append('label',  options.label);

  const res = await fetch('/api/assets/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'فشل رفع الملف');
  return data as UploadResult;
}

// ── Get a short-lived serve URL for an asset ──────────────
// Returns the /api/assets/serve redirect URL (not the raw Cloudinary URL)
export function getServeUrl(assetId: string, tenantId: string): string {
  return `/api/assets/serve?assetId=${encodeURIComponent(assetId)}&tenantId=${encodeURIComponent(tenantId)}`;
}

// ── Format file size for UI ───────────────────────────────
export function formatBytes(bytes: number): string {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Validate file client-side before upload ───────────────
const CLIENT_LIMITS: Record<string, number> = {
  'application/pdf':  50  * 1024 * 1024,
  'video/mp4':        500 * 1024 * 1024,
  'video/webm':       500 * 1024 * 1024,
  'video/quicktime':  500 * 1024 * 1024,
  'image/jpeg':       5   * 1024 * 1024,
  'image/png':        5   * 1024 * 1024,
  'image/webp':       5   * 1024 * 1024,
};

export function validateFileClient(file: File): string | null {
  const limit = CLIENT_LIMITS[file.type];
  if (!limit)       return `نوع الملف غير مدعوم: ${file.type}`;
  if (file.size > limit)
    return `الحجم يتجاوز الحد: ${formatBytes(file.size)} / ${formatBytes(limit)}`;
  if (file.size === 0) return 'الملف فارغ';
  return null; // valid
}
