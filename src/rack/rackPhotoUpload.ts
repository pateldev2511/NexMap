/**
 * Validation for user-uploaded device photos (Milestone C). A real product photo per device
 * is stored as a base64 data-URI in `extra.rackPhotoDataUri` and rendered by rackPhotoSkins
 * into the live canvas AND the PNG/PDF export. A Chromium+WebKit spike confirmed raster
 * data-URIs render and do NOT taint the export canvas.
 *
 * Defense-in-depth (the upload path feeds an SVG `<image>` that the exporter loads via
 * `Image()`): raster mimes ONLY — reject svg+xml so untrusted SVG never reaches that path —
 * and a hard size cap, because `.nexmap` saves are one JSON blob and base64 inflates ~33%.
 */

/** Max accepted photo size in bytes (pre-base64). */
export const PHOTO_MAX_BYTES = 512 * 1024; // 512 KB

/** Raster image mimes we accept. Deliberately excludes image/svg+xml and image/gif. */
export const ALLOWED_PHOTO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** `accept` attribute for the file input. */
export const PHOTO_ACCEPT = ALLOWED_PHOTO_MIMES.join(',');

export interface PhotoValidation {
  ok: boolean;
  error?: string;
}

/** Validate a chosen file's mime + size. Pure — takes the primitives, not a File. */
export function validatePhoto(type: string, size: number): PhotoValidation {
  if (!(ALLOWED_PHOTO_MIMES as readonly string[]).includes(type)) {
    return { ok: false, error: 'Use a PNG, JPEG, or WebP image (SVG and GIF are not allowed).' };
  }
  if (size > PHOTO_MAX_BYTES) {
    return { ok: false, error: `Image is too large (${Math.round(size / 1024)} KB). Max ${PHOTO_MAX_BYTES / 1024} KB.` };
  }
  if (size <= 0) {
    return { ok: false, error: 'That file looks empty.' };
  }
  return { ok: true };
}

/** True if a stored data-URI is an accepted raster photo (mirrors validatePhoto, for the render path). */
export function isRasterPhotoDataUri(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value);
}
