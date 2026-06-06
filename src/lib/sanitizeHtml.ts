/**
 * Rich-text sanitizer for component descriptions. The description is formatted HTML
 * stored verbatim in the `.nexmap` file, so it is UNTRUSTED on load — a hostile file
 * could carry `<img onerror>` or `<script>`. We therefore sanitize on BOTH write (as the
 * user types) and render (every display), with a strict allowlist. DOMPurify is imported
 * statically (not lazily) because render needs it synchronously.
 *
 * Allowlist: inline emphasis + lists + paragraphs/breaks only. No attributes, no links,
 * no images, no styles, no scripts.
 */
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'ul', 'ol', 'li'];

export function sanitizeHtml(html: string | undefined | null): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [], // no attributes at all → no style/href/onerror/etc.
    FORBID_ATTR: ['style', 'class', 'id'],
  });
}

/** True if the HTML has any visible text once tags are stripped (for empty-state checks). */
export function hasRichText(html: string | undefined | null): boolean {
  if (!html) return false;
  return sanitizeHtml(html).replace(/<[^>]*>/g, '').trim().length > 0;
}
