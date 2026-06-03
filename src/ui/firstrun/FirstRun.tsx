import { useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { TEMPLATES, buildTemplate } from '@/model/templates';
import { loadDocument } from '@/model/migrate';
import styles from './FirstRun.module.css';

/**
 * First-run start screen (design review DA-DES-1.3) — the cure for "four empty
 * regions greet a new user". Blank / template / open. The `.nexmap` open works
 * already because loadDocument + the migration guard exist (M1).
 */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const loadDoc = useProjectStore((s) => s.loadDoc);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function pickTemplate(key: string) {
    loadDoc(buildTemplate(key, new Date().toISOString()));
    onDone();
  }

  async function openFile(file: File) {
    setError(null);
    const text = await file.text();
    const result = loadDocument(text);
    if (result.ok) {
      loadDoc(result.doc);
      onDone();
    } else {
      setError(result.message);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          Nex<span>Map</span>
        </h1>
        <p className={styles.tagline}>
          Design network diagrams that validate themselves. Local, no login.
        </p>

        <div className={styles.grid}>
          {TEMPLATES.map((t) => (
            <button key={t.key} className={styles.template} onClick={() => pickTemplate(t.key)}>
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>

        <div className={styles.row}>
          <button className={styles.openBtn} onClick={() => fileRef.current?.click()}>
            Open .nexmap…
          </button>
          <span className={styles.localNote}>
            Your data stays on this device.
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".nexmap,.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
