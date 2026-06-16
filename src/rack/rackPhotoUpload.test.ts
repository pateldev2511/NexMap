import { describe, it, expect } from 'vitest';
import { validatePhoto, isRasterPhotoDataUri, PHOTO_MAX_BYTES } from './rackPhotoUpload';

describe('validatePhoto', () => {
  it('accepts png/jpeg/webp under the size cap', () => {
    expect(validatePhoto('image/png', 1000).ok).toBe(true);
    expect(validatePhoto('image/jpeg', 1000).ok).toBe(true);
    expect(validatePhoto('image/webp', 1000).ok).toBe(true);
  });

  it('rejects svg+xml (untrusted SVG into the export Image path)', () => {
    const r = validatePhoto('image/svg+xml', 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SVG/i);
  });

  it('rejects gif and other non-allowlisted mimes', () => {
    expect(validatePhoto('image/gif', 1000).ok).toBe(false);
    expect(validatePhoto('application/pdf', 1000).ok).toBe(false);
  });

  it('rejects files over the size cap', () => {
    const r = validatePhoto('image/png', PHOTO_MAX_BYTES + 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/i);
  });

  it('rejects empty files', () => {
    expect(validatePhoto('image/png', 0).ok).toBe(false);
  });
});

describe('isRasterPhotoDataUri', () => {
  it('accepts base64 raster data-URIs', () => {
    expect(isRasterPhotoDataUri('data:image/png;base64,AAAA')).toBe(true);
    expect(isRasterPhotoDataUri('data:image/webp;base64,AAAA')).toBe(true);
  });
  it('rejects svg+xml, non-base64, and non-strings', () => {
    expect(isRasterPhotoDataUri('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isRasterPhotoDataUri('data:image/png,rawsvg')).toBe(false);
    expect(isRasterPhotoDataUri(null)).toBe(false);
    expect(isRasterPhotoDataUri(42)).toBe(false);
  });
});
