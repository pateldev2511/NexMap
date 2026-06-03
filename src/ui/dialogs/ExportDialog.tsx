import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { runExport, type ExportFormat, type ExportOptions } from '@/io/export';
import styles from './ImportDialog.module.css';

/**
 * Export dialog (spec Export Options Panel). MVP scope: whole diagram, formats
 * PNG/JPG/SVG/PDF + CSV (inventory/links), scale, background/transparency,
 * include-labels, filename. Scope/view/layer selectors are Post-MVP.
 */
const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
  { key: 'svg', label: 'SVG' },
  { key: 'pdf', label: 'PDF' },
  { key: 'csv-inventory', label: 'CSV · Inventory' },
  { key: 'csv-links', label: 'CSV · Links' },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useProjectStore.getState;
  const projectName = useProjectStore((s) => s.projectName);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(true);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [includeLabels, setIncludeLabels] = useState(true);
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isRaster = format === 'png' || format === 'jpg' || format === 'pdf';
  const isImage = format === 'png' || format === 'jpg' || format === 'svg';
  const supportsTransparent = format === 'png' || format === 'svg';

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
        fileName: '',
      };
      const outcome = await runExport(
        {
          devices: store().devicesAll(),
          links: store().linksAll(),
          objects: store().objectsAll(),
          projectName,
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

  const deviceCount = store().devicesAll().length;

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

          <div className={styles.mapGrid}>
            {isRaster && (
              <>
                <label>Scale</label>
                <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
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
                    <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
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
            {!format.startsWith('csv') && (
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
              </>
            )}
          </div>

          <div className={styles.summary}>
            {format.startsWith('csv')
              ? `Exports the ${format === 'csv-inventory' ? 'device inventory' : 'link list'} as CSV.`
              : `Exports the whole diagram (${deviceCount} device${deviceCount === 1 ? '' : 's'}).`}
            {deviceCount === 0 && !format.startsWith('csv') && ' The canvas is empty.'}
          </div>
          {msg && <div className={styles.summary}>{msg}</div>}
        </div>
        <div className={styles.foot}>
          <button className={styles.btn} onClick={onClose}>
            Close
          </button>
          <button className={`${styles.btn} ${styles.primary}`} onClick={doExport} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
