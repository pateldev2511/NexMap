import { useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { parseCsv } from '@/lib/csv';
import {
  autoMap,
  buildDevices,
  buildLinks,
  DEVICE_FIELDS,
  LINK_FIELDS,
  type ImportKind,
} from '@/io/import/csvImport';
import styles from './ImportDialog.module.css';

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
  const [done, setDone] = useState<{ count: number; warnings: string[]; skipped: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const fields = kind === 'devices' ? DEVICE_FIELDS : LINK_FIELDS;
  const parsed = useMemo(() => (text ? parseCsv(text) : null), [text]);

  async function onFile(file: File) {
    const raw = await file.text();
    const p = parseCsv(raw);
    // Guess kind: source+target headers → links.
    const looksLikeLinks = autoMap(p.headers, LINK_FIELDS).source && autoMap(p.headers, LINK_FIELDS).target;
    const k: ImportKind = looksLikeLinks ? 'links' : 'devices';
    setKind(k);
    setText(raw);
    setFileName(file.name);
    setMapping(autoMap(p.headers, k === 'devices' ? DEVICE_FIELDS : LINK_FIELDS));
    setDone(null);
  }

  function reMap(k: ImportKind) {
    setKind(k);
    if (parsed) setMapping(autoMap(parsed.headers, k === 'devices' ? DEVICE_FIELDS : LINK_FIELDS));
  }

  // Live preview of what will be created with the current mapping.
  const result = useMemo(() => {
    if (!parsed) return null;
    return kind === 'devices'
      ? buildDevices(parsed.rows, mapping, store().defaultLayerId())
      : buildLinks(parsed.rows, mapping, store().devicesAll(), store().defaultLayerId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, mapping, kind]);

  function commit() {
    if (!result) return;
    store().importObjects(result.devices, result.links);
    store().runValidation();
    setDone({
      count: result.devices.length + result.links.length,
      warnings: result.warnings,
      skipped: result.skipped,
    });
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Import CSV</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {!text && (
            <div className={styles.dropzone} onClick={() => inputRef.current?.click()}>
              Choose a CSV file (devices or links).
              <br />
              Headers are auto-detected; you can adjust the mapping next.
            </div>
          )}

          {text && !done && parsed && (
            <>
              <div className={styles.kindRow}>
                <span style={{ alignSelf: 'center', color: 'var(--chrome-fg-muted)', fontSize: 12 }}>
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
                  Will import <strong>{result.devices.length + result.links.length}</strong>{' '}
                  {kind}
                  {result.skipped > 0 && ` · ${result.skipped} row(s) skipped`}
                  {parsed.rows.length > 5 && ` · ${parsed.rows.length} rows total`}
                </div>
              )}
              {result && result.warnings.length > 0 && (
                <div className={styles.warnings}>
                  {result.warnings.slice(0, 30).map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                  {result.warnings.length > 30 && <div>…and {result.warnings.length - 30} more.</div>}
                </div>
              )}
            </>
          )}

          {done && (
            <div className={styles.summary}>
              ✓ Imported <strong>{done.count}</strong> object{done.count === 1 ? '' : 's'}
              {done.skipped > 0 && `, skipped ${done.skipped} row(s)`}. Undo (Ctrl+Z) reverts the
              whole import.
              {done.warnings.length > 0 && (
                <div className={styles.warnings} style={{ marginTop: 8 }}>
                  {done.warnings.slice(0, 30).map((w, i) => (
                    <div key={i}>⚠ {w}</div>
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
            accept=".csv,text/csv"
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
                disabled={!result || result.devices.length + result.links.length === 0}
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
