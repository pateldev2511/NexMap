/**
 * The ZIP package end to end through runExport: the downloaded archive is unzipped
 * and its files compared with the Export dialog's preview and the whole project.
 * Rasterizing and jsPDF are stubbed (jsdom has no canvas); every raster call is
 * recorded so the PNG and PDF can be checked to come from the same SVG.
 */
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { BLUEPRINT } from '@/canvas/blueprintArt';
import { loadDocument } from '@/model/migrate';
import { buildSvg } from './buildSvg';
import { exportDiagramSvg, runExport, type ExportOptions, type ExportScene } from './index';
import { twoSiteDoc } from './__fixtures__/twoSite';

const raster = vi.hoisted(() => ({
  calls: [] as { svg: string; scale: number }[],
  clamped: false,
  downloads: [] as { blob: Blob; fileName: string }[],
}));

vi.mock('./raster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./raster')>();
  return {
    ...actual,
    rasterize: vi.fn(async (svg: string, o: { scale: number }) => {
      raster.calls.push({ svg, scale: o.scale });
      const effectiveScale = raster.clamped ? o.scale / 4 : o.scale;
      return { blob: new Blob(['png']), width: 10, height: 10, effectiveScale, clamped: raster.clamped };
    }),
    downloadBlob: vi.fn((blob: Blob, fileName: string) => raster.downloads.push({ blob, fileName })),
  };
});

vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 842, getHeight: () => 595 } };
    addImage() {}
    addPage() {}
    setFont() {}
    setFontSize() {}
    text() {}
    splitTextToSize(t: string) {
      return [t];
    }
    output() {
      return new Blob(['%PDF']);
    }
  },
}));

// jsdom's Blob can't be read back (no arrayBuffer); Node's can.
vi.stubGlobal('Blob', NodeBlob);
vi.stubGlobal(
  'FileReader',
  class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(b: NodeBlob) {
      void b.arrayBuffer().then((buf) => {
        this.result = `data:${b.type};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      });
    }
  },
);

beforeEach(() => {
  raster.calls = [];
  raster.clamped = false;
  raster.downloads = [];
});

/** The Export dialog's scene with Branch-office-style selection: just the HQ site. */
function hqSelection(): ExportScene {
  const { doc, hq } = twoSiteDoc();
  return {
    ...hq,
    objects: [],
    vlans: doc.vlans,
    subnets: doc.subnets,
    racks: doc.racks,
    projectName: 'Two sites',
    doc,
  };
}

const zipOpts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  format: 'zip',
  scale: 2,
  background: '#ffffff',
  includeLabels: true,
  quality: 0.92,
  pageSize: 'a4',
  orientation: 'landscape',
  fileName: '',
  ...over,
});

async function unzipDownload(): Promise<Record<string, Uint8Array>> {
  const { blob } = raster.downloads.at(-1)!;
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe('ZIP package — always the whole project', () => {
  it('ignores a selection scope: the editable file, CSVs and renders all carry both sites', async () => {
    const scene = hqSelection();
    await runExport(scene, zipOpts());
    const files = await unzipDownload();
    expect(Object.keys(files).sort()).toEqual(
      [
        'diagram.pdf',
        'diagram.png',
        'diagram.svg',
        'inventory.csv',
        'links.csv',
        'project.nexmap',
        'rules.csv',
        'validation-report.txt',
      ].sort(),
    );
    const reopened = loadDocument(strFromU8(files['project.nexmap']!));
    expect(reopened.ok && reopened.doc.devices).toHaveLength(4);
    const inventory = strFromU8(files['inventory.csv']!);
    expect(inventory).toContain('HQ-R1');
    expect(inventory).toContain('BR-R1');
    expect(strFromU8(files['validation-report.txt']!)).toContain('Devices: 4  Links: 3');
    const svg = strFromU8(files['diagram.svg']!);
    expect(svg).toContain('>BR-R1<');
  });
});

describe('ZIP package — renders match the export preview', () => {
  const cases: [string, Partial<ExportOptions>][] = [
    ['blueprint', { projection: 'blueprint' }],
    ['isometric', { projection: 'iso' }],
    ['labels off', { includeLabels: false }],
    ['modern', { modern: true }],
  ];
  for (const [name, over] of cases) {
    it(`${name}: diagram.svg is the preview, and the PNG and PDF are rasterized from it`, async () => {
      const scene = hqSelection();
      const opts = zipOpts(over);
      await runExport(scene, opts);
      const svg = strFromU8((await unzipDownload())['diagram.svg']!);
      expect(svg).toBe(exportDiagramSvg(scene, opts));
      expect(raster.calls.map((c) => c.svg)).toEqual([svg, svg]); // PNG, then the PDF's image
      expect(raster.calls.every((c) => c.scale === 2)).toBe(true);
    });
  }

  it('blueprint: the bundled sheet is on blueprint paper with its title block', async () => {
    await runExport(hqSelection(), zipOpts({ projection: 'blueprint' }));
    const svg = strFromU8((await unzipDownload())['diagram.svg']!);
    expect(svg).toContain(`fill="${BLUEPRINT.paper}"`);
    expect(svg).toContain('TWO SITES');
    expect(svg).not.toContain('fill="#ffffff"');
  });

  it('isometric: the bundled SVG is the iso projection, not the flat one', async () => {
    const { doc } = twoSiteDoc();
    const scene = { ...hqSelection(), doc };
    await runExport(scene, zipOpts({ projection: 'iso' }));
    const svg = strFromU8((await unzipDownload())['diagram.svg']!);
    const flat = buildSvg(doc.devices, doc.links, { background: '#ffffff', includeLabels: true, objects: [] });
    expect(svg).not.toBe(flat);
    expect(svg).toBe(
      buildSvg(doc.devices, doc.links, {
        background: '#ffffff',
        includeLabels: true,
        objects: [],
        projection: 'iso',
        title: 'Two sites',
        date: svg.match(/\d{4}-\d{2}-\d{2}/)?.[0],
      }),
    );
  });

  it('labels off: no device names in the bundled SVG', async () => {
    await runExport(hqSelection(), zipOpts({ includeLabels: false }));
    const svg = strFromU8((await unzipDownload())['diagram.svg']!);
    expect(svg).not.toContain('>HQ-R1<');
    expect(svg).not.toContain('>BR-R1<');
  });

  it('risk highlighting: the bundled SVG tints the risky link only when asked', async () => {
    const { doc, wan } = twoSiteDoc();
    const scene = { ...hqSelection(), doc };
    const health = { criticalLinkPairs: [[wan.sourceId, wan.targetId].sort().join('|')], conflictLinkIds: [] };
    await runExport(scene, zipOpts({ health }));
    expect(strFromU8((await unzipDownload())['diagram.svg']!)).toContain('#d97706');
    await runExport(scene, zipOpts({ health: null }));
    expect(strFromU8((await unzipDownload())['diagram.svg']!)).not.toContain('#d97706');
  });
});

describe('raster scale warnings', () => {
  it('warns when the PNG/PDF in a package came out smaller than asked', async () => {
    raster.clamped = true;
    const out = await runExport(hqSelection(), zipOpts({ scale: 4 }));
    expect(out.warning).toMatch(/too large at 4× — exported at 1\.00×/);
  });

  it('warns for a direct PDF too, not just PNG/JPG', async () => {
    raster.clamped = true;
    const out = await runExport(hqSelection(), zipOpts({ format: 'pdf', scale: 2 }));
    expect(out.warning).toMatch(/too large at 2× — exported at 0\.50×/);
  });

  it('stays quiet when nothing was reduced', async () => {
    expect((await runExport(hqSelection(), zipOpts())).warning).toBeUndefined();
    expect((await runExport(hqSelection(), zipOpts({ format: 'png' }))).warning).toBeUndefined();
  });
});

describe('ZIP package — raster fallback', () => {
  it('still ships the SVG and text files, with a warning, when rasterizing fails', async () => {
    const { rasterize } = await import('./raster');
    vi.mocked(rasterize).mockRejectedValueOnce(new Error('no canvas'));
    const out = await runExport(hqSelection(), zipOpts());
    const files = await unzipDownload();
    expect(files['diagram.svg']).toBeDefined();
    expect(files['project.nexmap']).toBeDefined();
    expect(files['diagram.png']).toBeUndefined();
    expect(files['diagram.pdf']).toBeUndefined();
    expect(out.warning).toMatch(/without diagram\.png and diagram\.pdf/);
  });
});
