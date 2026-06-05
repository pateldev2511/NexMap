import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { runExport, type ExportFormat, type ExportOptions } from '@/io/export';
import { buildSvg } from '@/io/export/buildSvg';
import type { CanvasObject, Device, Link } from '@/model/types';
import styles from './ImportDialog.module.css';

/**
 * Export dialog (Phase 3 upgrade): live preview, crop-to-selection, custom
 * filename, DPI/scale slider, transparent checkerboard preview, and a ZIP package.
 */
const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
  { key: 'svg', label: 'SVG' },
  { key: 'pdf', label: 'PDF' },
  { key: 'zip', label: 'ZIP package' },
  { key: 'csv-inventory', label: 'CSV · Inventory' },
  { key: 'csv-links', label: 'CSV · Links' },
];

type Scope = 'all' | 'selection';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useProjectStore.getState;
  const projectName = useProjectStore((s) => s.projectName);
  const selection = useProjectStore((s) => s.selection);
  useProjectStore((s) => s.rev); // refresh preview on model change
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scope, setScope] = useState<Scope>('all');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(true);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [includeLabels, setIncludeLabels] = useState(true);
  const [iso, setIso] = useState(() => store().projection === 'iso');
  const [quality, setQuality] = useState(0.92);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isRaster =
    format === 'png' || format === 'jpg' || format === 'pdf' || format === 'zip';
  const isImage = format === 'png' || format === 'jpg' || format === 'svg';
  const supportsTransparent = format === 'png' || format === 'svg';
  const isCsv = format.startsWith('csv');

  // Scope the scene to the selection if requested.
  const scene = useMemo(() => {
    const allD = store().devicesAll();
    const allL = store().linksAll();
    const allO = store().objectsAll();
    const doc = store().getDocument();
    const semantics = { vlans: doc.vlans, subnets: doc.subnets, racks: doc.racks };
    if (scope === 'all')
      return { devices: allD, links: allL, objects: allO, ...semantics };
    const sel = new Set(selection);
    const selectedLinks = allL.filter((l) => sel.has(l.id));
    const endpointIds = new Set<string>();
    for (const link of selectedLinks) {
      endpointIds.add(link.sourceId);
      endpointIds.add(link.targetId);
    }
    const devices = allD.filter((d) => sel.has(d.id) || endpointIds.has(d.id));
    const objects = allO.filter((o) => sel.has(o.id));
    const devSet = new Set(devices.map((d) => d.id));
    const links = allL.filter(
      (l) =>
        sel.has(l.id) ||
        (devSet.has(l.sourceId) &&
          devSet.has(l.targetId) &&
          sel.has(l.sourceId) &&
          sel.has(l.targetId)),
    );
    return { devices, links, objects, ...semantics };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selection, store]);

  const previewSvg = useMemo(
    () =>
      buildSvg(scene.devices as Device[], scene.links as Link[], {
        background: supportsTransparent && transparent ? null : bgColor,
        includeLabels,
        objects: scene.objects as CanvasObject[],
        projection: iso ? 'iso' : 'flat',
      }),
    [scene, transparent, bgColor, includeLabels, supportsTransparent, iso],
  );
  const previewUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(previewSvg);

  async function doExport() {
    setBusy(true);
    setMsg(null);
    try {
      const opts: ExportOptions = {
        format,
        scale,
        background: supportsTransparent && transparent ? null : bgColor,
        includeLabels,
        quality,
        pageSize: 'a4',
        orientation: 'landscape',
        fileName,
        projection: iso ? 'iso' : 'flat',
      };
      const outcome = await runExport(
        {
          ...scene,
          projectName,
          docJson: JSON.stringify(store().getDocument(), null, 2),
        },
        opts,
      );
      setMsg(outcome.warning ? `⚠ ${outcome.warning}` : `✓ Exported ${outcome.fileName}`);
    } catch (e) {
      setMsg(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    devices: scene.devices.length,
    links: scene.links.length,
    objects: scene.objects.length,
  };
  const count = counts.devices + counts.links + counts.objects;
  const empty = count === 0 && !isCsv;
  const countSummary = `${counts.devices} device${counts.devices === 1 ? '' : 's'}, ${counts.links} link${
    counts.links === 1 ? '' : 's'
  }, ${counts.objects} object${counts.objects === 1 ? '' : 's'}`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Export</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>
          <div className={styles.kindRow} style={{ flexWrap: 'wrap' }}>
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className={`${styles.kindBtn} ${format === f.key ? styles.active : ''}`}
                onClick={() => setFormat(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {!isCsv && (
            <div
              style={{
                marginBottom: 12,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--chrome-border)',
                background:
                  supportsTransparent && transparent
                    ? 'repeating-conic-gradient(#0000000d 0% 25%, transparent 0% 50%) 50% / 16px 16px'
                    : bgColor,
                display: 'grid',
                placeItems: 'center',
                minHeight: 160,
                maxHeight: 220,
              }}
            >
              {empty ? (
                <span style={{ color: 'var(--chrome-fg-muted)', fontSize: 12 }}>
                  Nothing to preview{' '}
                  {scope === 'selection' ? '(no selection)' : '(empty canvas)'}
                </span>
              ) : (
                <img
                  src={previewUrl}
                  alt="Export preview"
                  style={{ maxWidth: '100%', maxHeight: 218, objectFit: 'contain' }}
                />
              )}
            </div>
          )}

          <div className={styles.mapGrid}>
            <label>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="all">Entire diagram</option>
              <option value="selection">Selection only ({selection.size})</option>
            </select>

            {isRaster && (
              <>
                <label>Scale / DPI</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.5}
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    {scale}×
                  </span>
                </div>
              </>
            )}
            {isImage && (
              <>
                <label>Background</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {supportsTransparent && (
                    <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={transparent}
                        onChange={(e) => setTransparent(e.target.checked)}
                      />
                      Transparent
                    </label>
                  )}
                  {(!supportsTransparent || !transparent) && (
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                    />
                  )}
                </div>
              </>
            )}
            {format === 'jpg' && (
              <>
                <label>Quality</label>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
              </>
            )}
            {!isCsv && (
              <>
                <label>Labels</label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={includeLabels}
                    onChange={(e) => setIncludeLabels(e.target.checked)}
                  />
                  Include device names
                </label>
                <label>Projection</label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={iso}
                    onChange={(e) => setIso(e.target.checked)}
                  />
                  Isometric view
                </label>
              </>
            )}
            <label>Filename</label>
            <input
              value={fileName}
              placeholder={`${projectName} (auto)`}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>

          <div className={styles.summary}>
            {isCsv
              ? `Exports the ${format === 'csv-inventory' ? 'device inventory' : 'link list'} as CSV.`
              : format === 'zip'
                ? `Bundles .nexmap + PNG + SVG + PDF + CSVs + validation report (${countSummary}).`
                : `Exports ${scope === 'selection' ? 'the selection' : 'the whole diagram'} (${countSummary}).`}
          </div>
          {msg && <div className={styles.summary}>{msg}</div>}
        </div>
        <div className={styles.foot}>
          <button className={styles.btn} onClick={onClose}>
            Close
          </button>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={doExport}
            disabled={busy || (empty && !isCsv)}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
