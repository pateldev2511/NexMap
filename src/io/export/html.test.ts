import { describe, it, expect } from 'vitest';
import { buildStandaloneHtml } from './html';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>';

describe('buildStandaloneHtml', () => {
  it('produces a complete HTML document embedding the SVG verbatim', () => {
    const html = buildStandaloneHtml(SVG, { projectName: 'Core', deviceCount: 3, linkCount: 2 });
    expect(html.startsWith('<!doctype html')).toBe(true);
    expect(html).toContain(SVG);
    expect(html).toContain('</html>');
  });

  it('locks the file down with a no-network CSP', () => {
    const html = buildStandaloneHtml(SVG, { projectName: 'x', deviceCount: 0, linkCount: 0 });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('Content-Security-Policy');
  });

  it('makes no external network references (img/script/link to http)', () => {
    const html = buildStandaloneHtml(SVG, { projectName: 'x', deviceCount: 1, linkCount: 0 });
    expect(/(src|href)\s*=\s*"https?:/i.test(html)).toBe(false);
  });

  it('escapes the project name to prevent HTML injection', () => {
    const html = buildStandaloneHtml(SVG, {
      projectName: '<script>alert(1)</script>',
      deviceCount: 0,
      linkCount: 0,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('pluralizes counts correctly', () => {
    expect(buildStandaloneHtml(SVG, { projectName: 'x', deviceCount: 1, linkCount: 1 })).toContain(
      '1 device · 1 link',
    );
    expect(buildStandaloneHtml(SVG, { projectName: 'x', deviceCount: 2, linkCount: 0 })).toContain(
      '2 devices · 0 links',
    );
  });

  it('includes the inline pan/zoom viewer script', () => {
    const html = buildStandaloneHtml(SVG, { projectName: 'x', deviceCount: 0, linkCount: 0 });
    expect(html).toContain('nx-stage');
    expect(html).toContain('addEventListener');
  });
});
