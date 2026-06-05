import { useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { parseCsv } from '@/lib/csv';
import {
  autoMap,
  buildDevices,
  buildLinks,
  buildSubnets,
  buildVlans,
  detectCsvKind,
  DEVICE_FIELDS,
  LINK_FIELDS,
  type ImportKind,
} from '@/io/import/csvImport';
import {
  parseGraphml,
  parseDrawio,
  parseTopologyJson,
  parseNetboxJson,
  parseNmapXml,
  looksLikeNetbox,
  stripExternalSvgReferences,
  type ImportResult,
} from '@/io/import/graphImport';
import type { Subnet, Vlan } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ImportDialog.module.css';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 32_000_000;
const MAX_IMAGE_EDGE = 10_000;

type Done = { count: number; warnings: string[]; skipped: number; noun: string };
type SemanticResult = {
  name: string;
  subnets: Subnet[];
  vlans: Vlan[];
  warnings: string[];
  skipped: number;
};
type MediaResult = {
  name: string;
  href: string;
  width: number;
  height: number;
  warnings: string[];
  error?: string;
};

function WarningLine({ text }: { text: string }) {
  return (
    <div className={styles.messageLine}>
      <NexIcon name="warning" />
      <span>{text}</span>
    </div>
  );
}

function svgSize(svg: string): { width: number; height: number } {
  const width = Number(/(?:^|[\s<])width=["']?(\d+(?:\.\d+)?)/i.exec(svg)?.[1]);
  const height = Number(/(?:^|[\s<])height=["']?(\d+(?:\.\d+)?)/i.exec(svg)?.[1]);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  const viewBox = /\bviewBox=["']?([\d.-]+)\s+([\d.-]+)\s+([\d.]+)\s+([\d.]+)/i.exec(svg);
  const vbWidth = Number(viewBox?.[3]);
  const vbHeight = Number(viewBox?.[4]);
  if (
    Number.isFinite(vbWidth) &&
    vbWidth > 0 &&
    Number.isFinite(vbHeight) &&
    vbHeight > 0
  ) {
    return { width: vbWidth, height: vbHeight };
  }
  return { width: 400, height: 300 };
}

/**
 * CSV import flow (spec Import): pick → parse → preview → map → validate → confirm.
 * Apply is one atomic, undoable transaction via store.importObjects (DA-T2), so a
 * bad import never half-corrupts the project and Undo reverts it in one step.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const store = useProjectStore.getState;
  const [kind, setKind] = useState<ImportKind>('devices');
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [done, setDone] = useState<Done | null>(null);
  // Parsed result for non-CSV formats (GraphML / draw.io / JSON).
  const [graphResult, setGraphResult] = useState<{
    name: string;
    result: ImportResult;
  } | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticResult | null>(null);
  const [mediaResult, setMediaResult] = useState<MediaResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fields = kind === 'devices' ? DEVICE_FIELDS : LINK_FIELDS;
  const parsed = useMemo(() => (text ? parseCsv(text) : null), [text]);

  function clearPending() {
    setText(null);
    setGraphResult(null);
    setSemanticResult(null);
    setMediaResult(null);
  }

  function emptyImport(name: string, warning: string) {
    clearPending();
    setGraphResult({
      name,
      result: { devices: [], links: [], warnings: [warning], skipped: 0 },
    });
  }

  function setMediaPreview(
    name: string,
    href: string,
    width: number,
    height: number,
    warnings: string[] = [],
  ) {
    const pixels = width * height;
    const error =
      pixels > MAX_IMAGE_PIXELS || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE
        ? `Image is too large (${width}×${height}). Use ${MAX_IMAGE_EDGE}px or less per side and under ${MAX_IMAGE_PIXELS.toLocaleString()} pixels.`
        : undefined;
    setMediaResult({ name, href, width, height, warnings, error });
  }

  async function onFile(file: File) {
    setDone(null);
    setFileName(file.name);
    clearPending();
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    const layer = store().defaultLayerId();

    if (file.size === 0) {
      emptyImport(file.name, 'File is empty.');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      emptyImport(
        file.name,
        `File is too large (${Math.round(file.size / 1024 / 1024)} MB). Import files must be 20 MB or smaller.`,
      );
      return;
    }

    // Raster image → background underlay (read dims from the loaded image).
    if (IMAGE_EXTS.has(ext)) {
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(file);
      });
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 400;
        const h = img.naturalHeight || 300;
        const warnings =
          w > 4000 || h > 4000
            ? ['Image will be capped to 4000px per side when added to the canvas.']
            : [];
        setMediaPreview(file.name, dataUrl, w, h, warnings);
      };
      img.onerror = () => emptyImport(file.name, 'Image could not be decoded.');
      img.src = dataUrl;
      return;
    }

    const raw = await file.text();

    // SVG → sanitized background underlay (DOMPurify lazy-loaded — only here).
    if (ext === 'svg') {
      const DOMPurify = (await import('dompurify')).default;
      const purified = DOMPurify.sanitize(raw, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      const stripped = stripExternalSvgReferences(purified);
      const warnings =
        stripped.stripped > 0
          ? [`Removed ${stripped.stripped} external or unsafe SVG reference(s).`]
          : [];
      const size = svgSize(stripped.svg);
      setMediaPreview(
        file.name,
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(stripped.svg),
        size.width,
        size.height,
        warnings,
      );
      return;
    }

    if (ext === 'graphml') {
      setText(null);
      setGraphResult({ name: file.name, result: parseGraphml(raw, layer) });
      return;
    }
    if (ext === 'drawio' || ext === 'xml') {
      setText(null);
      // .xml may be Nmap (discovery) or draw.io (topology) — detect by content.
      const result = /<nmaprun/.test(raw)
        ? parseNmapXml(raw, layer)
        : parseDrawio(raw, layer);
      setGraphResult({ name: file.name, result });
      return;
    }
    if (ext === 'json') {
      setText(null);
      const result = looksLikeNetbox(raw)
        ? parseNetboxJson(raw, layer)
        : parseTopologyJson(raw, layer);
      setGraphResult({ name: file.name, result });
      return;
    }
    // CSV — detect sub-kind by headers.
    setGraphResult(null);
    const p = parseCsv(raw);
    const csvKind = detectCsvKind(p.headers);
    if (csvKind === 'subnets') {
      const subnets = buildSubnets(p.rows, p.headers);
      setSemanticResult({
        name: file.name,
        subnets,
        vlans: [],
        warnings: [],
        skipped: p.rows.length - subnets.length,
      });
      return;
    }
    if (csvKind === 'vlans') {
      const vlans = buildVlans(p.rows, p.headers);
      setSemanticResult({
        name: file.name,
        subnets: [],
        vlans,
        warnings: [],
        skipped: p.rows.length - vlans.length,
      });
      return;
    }
    const k: ImportKind = csvKind === 'links' ? 'links' : 'devices';
    setKind(k);
    setText(raw);
    setMapping(autoMap(p.headers, k === 'devices' ? DEVICE_FIELDS : LINK_FIELDS));
  }

  function reMap(k: ImportKind) {
    setKind(k);
    if (parsed)
      setMapping(autoMap(parsed.headers, k === 'devices' ? DEVICE_FIELDS : LINK_FIELDS));
  }

  // Live preview of what will be created with the current mapping.
  const result = useMemo(() => {
    if (!parsed) return null;
    return kind === 'devices'
      ? buildDevices(parsed.rows, mapping, store().defaultLayerId())
      : buildLinks(parsed.rows, mapping, store().devicesAll(), store().defaultLayerId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, mapping, kind]);

  function commitResult(r: ImportResult) {
    store().importObjects(r.devices, r.links);
    store().runValidation();
    setDone({
      count: r.devices.length + r.links.length,
      warnings: r.warnings,
      skipped: r.skipped,
      noun: 'object',
    });
    clearPending();
  }

  function commitSemantic(r: SemanticResult) {
    store().importSemantics(r.subnets, r.vlans);
    store().runValidation();
    setDone({
      count: r.subnets.length + r.vlans.length,
      warnings: r.warnings,
      skipped: r.skipped,
      noun: 'entry',
    });
    clearPending();
  }

  function commitMedia(r: MediaResult) {
    if (r.error) return;
    store().addImage(r.href, r.width, r.height);
    store().runValidation();
    setDone({ count: 1, warnings: r.warnings, skipped: 0, noun: 'underlay' });
    clearPending();
  }

  function commit() {
    if (graphResult) return commitResult(graphResult.result);
    if (semanticResult) return commitSemantic(semanticResult);
    if (mediaResult) return commitMedia(mediaResult);
    if (result) commitResult(result);
  }

  const canCommit = graphResult
    ? graphResult.result.devices.length + graphResult.result.links.length > 0
    : semanticResult
      ? semanticResult.subnets.length + semanticResult.vlans.length > 0
      : mediaResult
        ? !mediaResult.error
        : !!result && result.devices.length + result.links.length > 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Import</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <NexIcon name="close" />
          </button>
        </div>

        <div className={styles.body}>
          {!text && !graphResult && !semanticResult && !mediaResult && !done && (
            <div className={styles.dropzone} onClick={() => inputRef.current?.click()}>
              Choose a file: CSV (devices/links/IP/VLANs), GraphML, draw.io XML, Nmap XML,
              topology/NetBox JSON, or an image/SVG background underlay.
              <br />
              CSV headers are auto-detected; SVG underlays are sanitized on import.
            </div>
          )}

          {mediaResult && !done && (
            <>
              <div className={styles.summary}>
                <strong>{mediaResult.name}</strong> — will import a background underlay at{' '}
                <strong>
                  {mediaResult.width}×{mediaResult.height}
                </strong>
                .
              </div>
              <div className={styles.mediaPreview}>
                <img src={mediaResult.href} alt="Import preview" />
              </div>
              {mediaResult.error && (
                <div className={styles.error}>{mediaResult.error}</div>
              )}
              {mediaResult.warnings.length > 0 && (
                <div className={styles.warnings}>
                  {mediaResult.warnings.map((w, i) => (
                    <WarningLine key={i} text={w} />
                  ))}
                </div>
              )}
            </>
          )}

          {semanticResult && !done && (
            <>
              <div className={styles.summary}>
                <strong>{semanticResult.name}</strong> — will import{' '}
                <strong>{semanticResult.subnets.length}</strong> subnet(s) and{' '}
                <strong>{semanticResult.vlans.length}</strong> VLAN(s)
                {semanticResult.skipped > 0 && `, ${semanticResult.skipped} skipped`}.
              </div>
              <div className={styles.previewWrap}>
                <table className={styles.preview}>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Value</th>
                      <th>Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.subnets.slice(0, 5).map((subnet) => (
                      <tr key={subnet.id}>
                        <td>Subnet</td>
                        <td>{subnet.cidr}</td>
                        <td>{subnet.name ?? ''}</td>
                      </tr>
                    ))}
                    {semanticResult.vlans.slice(0, 5).map((vlan) => (
                      <tr key={vlan.id}>
                        <td>VLAN</td>
                        <td>{vlan.vlanId}</td>
                        <td>{vlan.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {graphResult && !done && (
            <>
              <div className={styles.summary}>
                <strong>{graphResult.name}</strong> — will import{' '}
                <strong>{graphResult.result.devices.length}</strong> devices and{' '}
                <strong>{graphResult.result.links.length}</strong> links
                {graphResult.result.skipped > 0 &&
                  `, ${graphResult.result.skipped} skipped`}
                .
              </div>
              {graphResult.result.warnings.length > 0 && (
                <div className={styles.warnings}>
                  {graphResult.result.warnings.slice(0, 30).map((w, i) => (
                    <WarningLine key={i} text={w} />
                  ))}
                </div>
              )}
            </>
          )}

          {text && !done && parsed && (
            <>
              <div className={styles.kindRow}>
                <span
                  style={{
                    alignSelf: 'center',
                    color: 'var(--chrome-fg-muted)',
                    fontSize: 12,
                  }}
                >
                  {fileName} — importing as:
                </span>
                <button
                  className={`${styles.kindBtn} ${kind === 'devices' ? styles.active : ''}`}
                  onClick={() => reMap('devices')}
                >
                  Devices
                </button>
                <button
                  className={`${styles.kindBtn} ${kind === 'links' ? styles.active : ''}`}
                  onClick={() => reMap('links')}
                >
                  Links
                </button>
              </div>

              <div className={styles.mapGrid}>
                {fields.map((f) => (
                  <FieldRow
                    key={f.key}
                    label={f.key}
                    headers={parsed.headers}
                    value={mapping[f.key] ?? ''}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v || null }))}
                  />
                ))}
              </div>

              <div className={styles.previewWrap}>
                <table className={styles.preview}>
                  <thead>
                    <tr>
                      {parsed.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {parsed.headers.map((h) => (
                          <td key={h}>{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result && (
                <div className={styles.summary}>
                  Will import{' '}
                  <strong>{result.devices.length + result.links.length}</strong> {kind}
                  {result.skipped > 0 && ` · ${result.skipped} row(s) skipped`}
                  {parsed.rows.length > 5 && ` · ${parsed.rows.length} rows total`}
                </div>
              )}
              {result && result.warnings.length > 0 && (
                <div className={styles.warnings}>
                  {result.warnings.slice(0, 30).map((w, i) => (
                    <WarningLine key={i} text={w} />
                  ))}
                  {result.warnings.length > 30 && (
                    <div>…and {result.warnings.length - 30} more.</div>
                  )}
                </div>
              )}
            </>
          )}

          {done && (
            <div className={styles.summary}>
              <div className={styles.messageLine}>
                <NexIcon name="check" />
                <span>
                  Imported <strong>{done.count}</strong> {done.noun}
                  {done.count === 1 ? '' : 's'}
                  {done.skipped > 0 && `, skipped ${done.skipped} row(s)`}. Undo (Ctrl+Z)
                  reverts the whole import.
                </span>
              </div>
              {done.warnings.length > 0 && (
                <div className={styles.warnings} style={{ marginTop: 8 }}>
                  {done.warnings.slice(0, 30).map((w, i) => (
                    <WarningLine key={i} text={w} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.foot}>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.graphml,.drawio,.xml,.json,.svg,.png,.jpg,.jpeg,.webp,.gif,text/csv,application/xml,application/json,image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await onFile(file);
              e.target.value = '';
            }}
          />
          {done ? (
            <button className={`${styles.btn} ${styles.primary}`} onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className={styles.btn} onClick={onClose}>
                Cancel
              </button>
              <button
                className={`${styles.btn} ${styles.primary}`}
                disabled={!canCommit}
                onClick={commit}
              >
                Import
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  headers,
  value,
  onChange,
}: {
  label: string;
  headers: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— not mapped —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </>
  );
}
