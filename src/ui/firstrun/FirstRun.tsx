import { useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import {
  TEMPLATES,
  buildTemplate,
  CATEGORY_LABEL,
  type TemplateCategory,
} from '@/model/templates';
import { loadDocument } from '@/model/migrate';
import styles from './FirstRun.module.css';

const SECTION_ORDER: TemplateCategory[] = ['general', 'home', 'enterprise'];

/**
 * First-run start screen (design review DA-DES-1.3) — the cure for "four empty
 * regions greet a new user". Blank / template / open. The `.nexmap` open works
 * already because loadDocument + the migration guard exist (M1).
 */
export function FirstRun({
  onDone,
  onOpenText,
}: {
  onDone: () => void;
  onOpenText?: (text: string) => void;
}) {
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
    if (onOpenText) {
      onOpenText(text);
      onDone();
      return;
    }
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

        <div className={styles.templates}>
          {SECTION_ORDER.map((cat) => {
            const items = TEMPLATES.filter((t) => t.category === cat);
            if (items.length === 0) return null;
            return (
              <section key={cat} className={styles.section}>
                <div className={styles.sectionTitle}>{CATEGORY_LABEL[cat]}</div>
                <div className={styles.grid}>
                  {items.map((t) => (
                    <button
                      key={t.key}
                      className={styles.template}
                      onClick={() => pickTemplate(t.key)}
                    >
                      <strong>{t.name}</strong>
                      <span>{t.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className={styles.row}>
          <button className={styles.openBtn} onClick={() => fileRef.current?.click()}>
            Open .nexmap…
          </button>
          <span className={styles.localNote}>Your data stays on this device.</span>
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
