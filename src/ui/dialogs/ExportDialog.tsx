import { useMemo, useState } from 'react';
import { useProjectStore, type Projection } from '@/store/projectStore';
import {
  exportDiagramSvg,
  formatHasScope,
  runExport,
  type ExportFormat,
  type ExportOptions,
  type ExportScene,
} from '@/io/export';
import { documentRules } from '@/io/export/rulesReport';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ImportDialog.module.css';

/**
 * Export dialog (Phase 3 upgrade): live preview, crop-to-selection, custom
 * filename, DPI/scale slider, transparent checkerboard preview, and a ZIP package.
 * The preview is the very SVG the chosen format writes (exportDiagramSvg), and the
 * ZIP package is always the whole project, so Scope isn't offered for it.
 */
const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
  { key: 'svg', label: 'SVG' },
  { key: 'html', label: 'HTML (viewer)' },
  { key: 'pdf', label: 'PDF' },
  { key: 'zip', label: 'ZIP package' },
  { key: 'csv-inventory', label: 'CSV · Inventory' },
  { key: 'csv-links', label: 'CSV · Links' },
  { key: 'csv-rules', label: 'CSV · Rules' },
];

type Scope = 'all' | 'selection';
type ExportMessage = { tone: 'success' | 'warning' | 'error'; text: string };

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useProjectStore.getState;
  const projectName = useProjectStore((s) => s.projectName);
  const selection = useProjectStore((s) => s.selection);
  const rev = useProjectStore((s) => s.rev); // refresh preview on model change
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scope, setScope] = useState<Scope>('all');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(true);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [includeLabels, setIncludeLabels] = useState(true);
  const [modern, setModern] = useState(false);
  const [projection, setProjection] = useState<Projection>(() => store().projection);
  const blueprint = projection === 'blueprint';
  const [highlightHealth, setHighlightHealth] = useState(true);
  const [quality, setQuality] = useState(0.92);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ExportMessage | null>(null);

  const isRaster =
    format === 'png' || format === 'jpg' || format === 'pdf' || format === 'zip';
  const isImage = format === 'png' || format === 'jpg' || format === 'svg';
  const supportsTransparent = format === 'png' || format === 'svg';
  const isCsv = format.startsWith('csv');
  const declaredRules = useProjectStore((s) => s.invariantsEnabled.size + s.customRules.length);
  const hasScope = formatHasScope(format);
  const effectiveScope: Scope = hasScope ? scope : 'all';

  // Scope the scene to the selection if requested (and the format honors a scope).
  const scene = useMemo((): ExportScene => {
    void rev;
    const allD = store().devicesAll();
    const allL = store().linksAll();
    const allO = store().objectsAll();
    const doc = store().getDocument();
    const whole = {
      vlans: doc.vlans,
      subnets: doc.subnets,
      racks: doc.racks,
      projectName,
      doc,
      // Rules describe the whole design, so they're never cut to the export scope.
      rules: documentRules(doc),
    };
    if (effectiveScope === 'all')
      return { devices: allD, links: allL, objects: allO, ...whole };
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
    return { devices, links, objects, ...whole };
  }, [effectiveScope, selection, store, rev, projectName]);

  // One option set for the preview AND the export, so the file is what you saw.
  const health = useProjectStore((s) => s.health);
  const opts = useMemo(
    (): ExportOptions => ({
      format,
      scale,
      background: supportsTransparent && transparent ? null : bgColor,
      includeLabels,
      quality,
      pageSize: 'a4',
      orientation: 'landscape',
      fileName,
      projection,
      health: highlightHealth ? health : null,
      modern,
    }),
    [format, scale, supportsTransparent, transparent, bgColor, includeLabels, quality, fileName, projection, highlightHealth, health, modern],
  );
  const previewSvg = useMemo(() => exportDiagramSvg(scene, opts), [scene, opts]);
  const previewUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(previewSvg);

  async function doExport() {
    setBusy(true);
    setMsg(null);
    try {
      const outcome = await runExport(scene, opts);
      setMsg(
        outcome.warning
          ? { tone: 'warning', text: outcome.warning }
          : { tone: 'success', text: `Exported ${outcome.fileName}` },
      );
    } catch (e) {
      setMsg({ tone: 'error', text: `Export failed: ${(e as Error).message}` });
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
  const rulesNote =
    declaredRules === 0 ? '' : ` + ${declaredRules} declared rule${declaredRules === 1 ? '' : 's'}, checked on the whole design`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Export</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <NexIcon name="close" />
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
                  {effectiveScope === 'selection' ? '(no selection)' : '(empty canvas)'}
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
            {/* Rules describe the whole design, and a package is the whole project,
                so neither has a scope. */}
            {hasScope && (
              <>
                <label htmlFor="export-scope">Scope</label>
                <select id="export-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  <option value="all">Entire diagram</option>
                  <option value="selection">Selection only ({selection.size})</option>
                </select>
              </>
            )}

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
                  {/* A blueprint is pale ink on its own paper — never transparent. */}
                  {blueprint && <span>Blueprint paper</span>}
                  {!blueprint && supportsTransparent && (
                    <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={transparent}
                        onChange={(e) => setTransparent(e.target.checked)}
                      />
                      Transparent
                    </label>
                  )}
                  {!blueprint && (!supportsTransparent || !transparent) && (
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
                <label htmlFor="export-projection">Projection</label>
                <select
                  id="export-projection"
                  value={projection}
                  onChange={(e) => setProjection(e.target.value as Projection)}
                >
                  <option value="flat">Flat (2D)</option>
                  <option value="iso">Isometric</option>
                  <option value="blueprint">Blueprint sheet (title block, on blue paper)</option>
                </select>
                <label>Style</label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={modern && !blueprint}
                    disabled={blueprint}
                    onChange={(e) => setModern(e.target.checked)}
                  />
                  Modern (cards, shadows, dot grid)
                </label>
              </>
            )}
            {!isCsv && (
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={highlightHealth}
                  onChange={(e) => setHighlightHealth(e.target.checked)}
                />
                Highlight risks (SPOF / conflicts)
              </label>
            )}
            <label>Filename</label>
            <input
              value={fileName}
              placeholder={`${projectName} (auto)`}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>

          <div className={styles.summary}>
            {format === 'csv-rules'
              ? declaredRules === 0
                ? 'No rules declared yet — declare some in the Rules tab (or type one in ⌘K).'
                : `Exports ${declaredRules} declared rule${declaredRules === 1 ? '' : 's'} with status and, for each broken one, every offender and why — checked against the whole design.`
              : isCsv
              ? `Exports the ${format === 'csv-inventory' ? 'device inventory' : 'link list'} as CSV.`
              : format === 'zip'
                ? `Packages the whole project${scope === 'selection' ? ', not just the selection' : ''}: .nexmap + PNG + SVG + PDF + CSVs + validation report (${countSummary}${rulesNote}).`
                : format === 'html'
                  ? `A single self-contained .html file with a pan/zoom viewer — opens in any browser, 100% local, no NexMap needed (${countSummary}${rulesNote}).`
                  : `Exports ${scope === 'selection' ? 'the selection' : 'the whole diagram'} (${countSummary}${format === 'pdf' ? rulesNote : ''}).`}
          </div>
          {msg && (
            <div
              className={styles.summary}
              style={{
                color:
                  msg.tone === 'success'
                    ? 'var(--sev-info)'
                    : msg.tone === 'warning'
                      ? 'var(--sev-warn)'
                      : 'var(--sev-error)',
              }}
            >
              <div className={styles.messageLine}>
                <NexIcon name={msg.tone === 'success' ? 'check' : 'warning'} />
                <span>{msg.text}</span>
              </div>
            </div>
          )}
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
