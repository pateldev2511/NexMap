import { describe, it, expect } from 'vitest';
import { sanitizeHtml, hasRichText } from './sanitizeHtml';
import { VENDORS, MODELS, ROLES } from './deviceCatalog';

describe('sanitizeHtml', () => {
  it('keeps allowlisted formatting tags', () => {
    const html = '<p>Core <b>router</b> <i>primary</i> <u>x</u> <s>old</s></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps ordered and unordered lists', () => {
    const ul = '<ul><li>a</li><li>b</li></ul>';
    const ol = '<ol><li>1</li><li>2</li></ol>';
    expect(sanitizeHtml(ul)).toBe(ul);
    expect(sanitizeHtml(ol)).toBe(ol);
  });

  it('strips <script>', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>hi</p>');
  });

  it('strips onerror / event-handler attributes (the .nexmap attack)', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
  });

  it('strips links and images entirely', () => {
    expect(sanitizeHtml('<a href="https://evil.com">x</a>')).not.toContain('<a');
    expect(sanitizeHtml('<a href="https://evil.com">x</a>')).toContain('x');
    expect(sanitizeHtml('<img src="https://evil.com/p.png">')).not.toContain('<img');
  });

  it('strips style/class/id attributes from allowed tags', () => {
    const out = sanitizeHtml('<p style="x" class="y" id="z">t</p>');
    expect(out).toBe('<p>t</p>');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('hasRichText', () => {
  it('detects visible text vs empty markup', () => {
    expect(hasRichText('<p>hello</p>')).toBe(true);
    expect(hasRichText('<p></p>')).toBe(false);
    expect(hasRichText('<ul><li></li></ul>')).toBe(false);
    expect(hasRichText(undefined)).toBe(false);
  });
});

describe('deviceCatalog presets', () => {
  it('provides non-empty vendor/model/role lists', () => {
    expect(VENDORS.length).toBeGreaterThan(3);
    expect(MODELS.length).toBeGreaterThan(3);
    expect(ROLES.length).toBeGreaterThan(3);
    expect(VENDORS).toContain('Cisco');
    expect(ROLES).toContain('Core');
  });
});
