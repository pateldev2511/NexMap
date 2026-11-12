import { useEffect, useRef, useState } from 'react';
import { NexMapLogo } from '@/ui/deck/NexMapLogo';
import { useProjectStore } from '@/store/projectStore';
import {
  TEMPLATES,
  buildTemplate,
  CATEGORY_LABEL,
  type TemplateCategory,
} from '@/model/templates';
import { loadDocument, loadRepairSummary } from '@/model/migrate';
import styles from './FirstRun.module.css';

/**
 * The start screen belongs to an untouched project. `docRevision` is bumped by every
 * model write (NexText, paste, import, any edit) and reset to 0 only when a document
 * is loaded or a new one starts — so the gallery goes away the moment the project
 * stops being untouched, by any route, without each route having to say so.
 * Boot-time validation does not write the model, so a fresh start stays at 0.
 */
export function shouldShowFirstRun(s: {
  done: boolean;
  docRevision: number;
  recoverable: boolean;
  mode: 'network' | 'rack' | null;
}): boolean {
  return !s.done && s.docRevision === 0 && !s.recoverable && s.mode === 'network';
}

const SECTION_ORDER: TemplateCategory[] = ['general', 'home', 'enterprise'];

/**
 * First-run start screen (design review DA-DES-1.3) — the cure for "four empty
 * regions greet a new user". Blank / template / open. The `.nexmap` open works
 * already because loadDocument + the migration guard exist (M1).
 */
export function FirstRun({
  onDone,
  onBlank,
  onOpenText,
}: {
  onDone: () => void;
  /** ✕ / Escape: keep the empty project and just close the gallery. Changes nothing. */
  onBlank?: () => void;
  /** Opens the text as the project; resolves false if it was refused or cancelled. */
  onOpenText?: (text: string) => Promise<boolean>;
}) {
  const loadDoc = useProjectStore((s) => s.loadDoc);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Take focus so Escape works straight away (the canvas behind is not interactive).
  useEffect(() => {
    if (onBlank) closeRef.current?.focus();
  }, [onBlank]);

  function pickTemplate(key: string) {
    loadDoc(buildTemplate(key, new Date().toISOString()));
    onDone();
  }

  async function openFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      if (onOpenText) {
        // A refused file keeps the start screen up (the reason shows as a toast).
        if (await onOpenText(text)) onDone();
        return;
      }
      const result = loadDocument(text);
      if (result.ok) {
        loadDoc(result.doc);
        // Say what the load repaired (the gallery is closing, so use the app's banner).
        const repaired = loadRepairSummary(result);
        if (repaired) useProjectStore.getState().setFlash(repaired);
        onDone();
      } else {
        setError(result.message);
      }
    } catch (err) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
      setError(`Could not read “${file.name}”${reason}. Nothing was opened.`);
    }
  }

  return (
    <div
      className={styles.overlay}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onBlank) {
          e.stopPropagation();
          onBlank();
        }
      }}
    >
      <div className={styles.card} role="dialog" aria-label="Start a new project">
        <div className={styles.head}>
          <NexMapLogo size={30} />
          <span className={styles.kicker}>NEW PROJECT</span>
          {onBlank && (
            <button
              ref={closeRef}
              type="button"
              className={styles.close}
              onClick={onBlank}
              aria-label="Close and start with a blank project"
              title="Blank project (Esc)"
            >
              ✕
            </button>
          )}
        </div>
        <p className={styles.tagline}>
          Design network diagrams that validate themselves. Local, no login — start
          from a blank canvas or a ready-made topology.
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
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
