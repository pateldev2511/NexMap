import { describe, it, expect } from 'vitest';
import { buildStandaloneHtml } from './html';
import type { RuleReportEntry } from './rulesReport';

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

describe('buildStandaloneHtml — declared rules panel', () => {
  const rules: RuleReportEntry[] = [
    { label: 'Every device is named', kind: 'built-in', status: 'met', offenders: [] },
    {
      label: 'Every “camera” lives in “CCTV”',
      kind: 'placement',
      status: 'broken',
      offenders: [{ id: 'dev-1', name: 'Cam Lobby', reason: '10.10.0.21 is in “Office”, not “CCTV”' }],
    },
    { label: 'quorum rule', kind: 'quorum', status: 'not checked', offenders: [] },
  ];
  const meta = { projectName: 'x', deviceCount: 1, linkCount: 0 };

  it('has no panel when no rules are declared', () => {
    expect(buildStandaloneHtml(SVG, meta)).not.toContain('id="nx-rules"');
    expect(buildStandaloneHtml(SVG, { ...meta, rules: [] })).not.toContain('id="nx-rules"');
  });

  it('leads with the verdict and lists every rule with a text status (not color alone)', () => {
    const html = buildStandaloneHtml(SVG, { ...meta, rules });
    expect(html).toContain('<summary>Rules · 1 of 3 rules met</summary>');
    expect(html).toMatch(/class="rule met">.*✓.*Every device is named.* — met/);
    expect(html).toMatch(/class="rule broken">.*✕.*Every “camera” lives in “CCTV”.* — broken/);
    expect(html).toMatch(/class="rule unchecked">.*rule from a newer NexMap/);
  });

  it('lists each offender as a button aimed at its data-id on the diagram, with the reason', () => {
    const html = buildStandaloneHtml(SVG, { ...meta, rules });
    expect(html).toContain('data-target="dev-1">Cam Lobby</button>');
    expect(html).toContain('10.10.0.21 is in “Office”, not “CCTV”');
    expect(html).toContain('nx-hit');
  });

  it('escapes rule labels, offender names and ids', () => {
    const evil: RuleReportEntry[] = [
      {
        label: '<img src=x onerror=alert(1)>',
        kind: 'placement',
        status: 'broken',
        offenders: [{ id: '"><script>', name: '<b>x</b>', reason: '<i>y</i>' }],
      },
    ];
    const html = buildStandaloneHtml(SVG, { ...meta, rules: evil });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('still makes no network references with the panel', () => {
    const html = buildStandaloneHtml(SVG, { ...meta, rules });
    expect(/(src|href)\s*=\s*"https?:/i.test(html)).toBe(false);
  });
});
