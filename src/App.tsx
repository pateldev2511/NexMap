import { useEffect, useRef, useState } from 'react';
import { AppShell } from './ui/shell/AppShell';
import { Library } from './ui/LeftSidebar/Library';
import { Inspector } from './ui/Inspector/Inspector';
import { BottomPanel } from './ui/BottomPanel/BottomPanel';
import { FirstRun } from './ui/firstrun/FirstRun';
import { RecoveryDialog } from './ui/dialogs/RecoveryDialog';
import { ImportDialog } from './ui/dialogs/ImportDialog';
import { ExportDialog } from './ui/dialogs/ExportDialog';
import { ShortcutsDialog } from './ui/dialogs/ShortcutsDialog';
import { ReadOnlyBanner, ErrorToast } from './ui/dialogs/ReadOnlyBanner';
import { Canvas } from './canvas/Canvas';
import { PerfHarness } from './perf/PerfHarness';
import { useProjectStore } from './store/projectStore';
import { usePersistence } from './persistence/usePersistence';
import { canOpenPicker } from './persistence/fsaccess';
import { severityRank } from './model/validate';
import shell from './ui/shell/AppShell.module.css';

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem('nexmap.theme') === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('nexmap.theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

function ValidationSummary() {
  const issues = useProjectStore((s) => s.issues);
  if (issues.length === 0) return <span>No issues</span>;
  const worst = issues.reduce(
    (max, i) => (severityRank(i.severity) > severityRank(max) ? i.severity : max),
    'info' as (typeof issues)[number]['severity'],
  );
  const color =
    worst === 'error' || worst === 'critical' ? 'var(--sev-error)' : 'var(--sev-warn)';
  return (
    <span style={{ color }}>
      {issues.length} issue{issues.length === 1 ? '' : 's'}
    </span>
  );
}

function EditableTitle() {
  const name = useProjectStore((s) => s.projectName);
  const dirty = useProjectStore((s) => s.dirty);
  const rename = useProjectStore((s) => s.renameProject);
  const endEdit = useProjectStore((s) => s.endEdit);
  return (
    <div className={shell.titleEdit}>
      <input
        className={shell.titleInput}
        value={name}
        aria-label="Project name"
        onChange={(e) => rename(name, e.target.value)}
        onBlur={endEdit}
      />
      {dirty && <span className={shell.dirtyDot} title="Unsaved changes" />}
    </div>
  );
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<'editor' | 'perf'>('editor');
  const [firstRunDone, setFirstRunDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const runValidation = useProjectStore((s) => s.runValidation);
  const newProject = useProjectStore((s) => s.newProject);
  const dirty = useProjectStore((s) => s.dirty);

  const persistence = usePersistence();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live validation: re-run debounced on any model change (the wedge — DA-DES-2.5).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = useProjectStore.subscribe((s, prev) => {
      if (s.rev === prev.rev) return;
      clearTimeout(t);
      t = setTimeout(() => useProjectStore.getState().runValidation(), 300);
    });
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, []);

  function doUndo() {
    undo();
    runValidation();
  }
  function doRedo() {
    redo();
    runValidation();
  }

  function handleNew() {
    if (dirty && !confirm('Discard unsaved changes and start a new project?')) return;
    newProject(new Date().toISOString());
    setFirstRunDone(true);
  }

  async function handleOpen() {
    if (canOpenPicker) await persistence.open();
    else fileInputRef.current?.click();
  }

  const actions = (
    <>
      <button className={shell.topbarBtn} onClick={handleNew} title="New project (Ctrl+N)">
        New
      </button>
      <button className={shell.topbarBtn} onClick={handleOpen} title="Open .nexmap (Ctrl+O)">
        Open
      </button>
      <button className={shell.topbarBtn} onClick={() => persistence.save()} title="Save (Ctrl+S)">
        Save
      </button>
      <button className={shell.topbarBtn} onClick={() => setImporting(true)} title="Import CSV">
        Import
      </button>
      <button className={shell.topbarBtn} onClick={() => setExporting(true)} title="Export (Ctrl+E)">
        Export
      </button>
      <button className={shell.topbarBtn} onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        ↶
      </button>
      <button className={shell.topbarBtn} onClick={doRedo} disabled={!canRedo} title="Redo">
        ↷
      </button>
      <button
        className={shell.topbarBtn}
        onClick={() => setView((v) => (v === 'editor' ? 'perf' : 'editor'))}
      >
        {view === 'editor' ? 'Perf' : 'Editor'}
      </button>
      <button className={shell.topbarBtn} onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'light' ? '☽' : '☀'}
      </button>
      <button className={shell.topbarBtn} onClick={() => setShowHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
        ?
      </button>
    </>
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (k === 's') {
        e.preventDefault();
        void persistence.save();
      } else if (k === 'o') {
        e.preventDefault();
        void handleOpen();
      } else if (k === 'e') {
        e.preventDefault();
        setExporting(true);
      }
    };
    const onHelp = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onHelp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onHelp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence]);

  if (view === 'perf') {
    return (
      <AppShell
        actions={actions}
        projectName="M0 SVG perf harness"
        canvas={<PerfHarness />}
        status={<span>M0 benchmark — drives the M2 renderer decision</span>}
      />
    );
  }

  const showRecovery = !firstRunDone && persistence.recoverable !== null;
  const showFirstRun = !firstRunDone && persistence.recoverable === null;

  return (
    <AppShell
      actions={actions}
      titleNode={<EditableTitle />}
      left={<Library />}
      right={<Inspector />}
      canvas={
        <>
          {persistence.readOnly && <ReadOnlyBanner />}
          <Canvas />
          {showFirstRun && (
            <FirstRun onDone={() => setFirstRunDone(true)} onOpenText={persistence.openText} />
          )}
          {showRecovery && persistence.recoverable && (
            <RecoveryDialog
              draft={persistence.recoverable}
              onRecover={() => {
                persistence.recover();
                setFirstRunDone(true);
              }}
              onDiscard={() => {
                persistence.discardDraft();
              }}
            />
          )}
          {persistence.error && <ErrorToast message={persistence.error} />}
          {importing && <ImportDialog onClose={() => setImporting(false)} />}
          {exporting && <ExportDialog onClose={() => setExporting(false)} />}
          {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
          <input
            ref={fileInputRef}
            type="file"
            accept=".nexmap,.json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) persistence.openText(await file.text());
              e.target.value = '';
            }}
          />
        </>
      }
      bottom={<BottomPanel />}
      status={<StatusBar persistence={persistence} />}
    />
  );
}

function StatusBar({ persistence }: { persistence: ReturnType<typeof usePersistence> }) {
  const label =
    persistence.status === 'saving'
      ? 'Saving…'
      : persistence.status === 'readonly'
        ? 'Read-only'
        : persistence.status === 'error'
          ? 'Autosave failed'
          : persistence.lastSavedAt
            ? `Autosaved ${persistence.lastSavedAt}`
            : 'All changes saved locally';
  return (
    <>
      <span>{persistence.fileName ?? 'Not saved to a file yet'}</span>
      <span>{label}</span>
      <span style={{ marginLeft: 'auto' }} />
      <ValidationSummary />
    </>
  );
}
