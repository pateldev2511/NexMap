import { useEffect, useRef, useState } from 'react';
import { AppShell } from './ui/shell/AppShell';
import { LeftPanel } from './ui/LeftSidebar/LeftPanel';
import { Inspector } from './ui/Inspector/Inspector';
import { BottomPanel } from './ui/BottomPanel/BottomPanel';
import { FirstRun } from './ui/firstrun/FirstRun';
import { RecoveryDialog } from './ui/dialogs/RecoveryDialog';
import { ImportDialog } from './ui/dialogs/ImportDialog';
import { NexTextDialog } from './ui/dialogs/NexTextDialog';
import { usePasteToCanvas } from './io/import/usePasteToCanvas';
import { ExportDialog } from './ui/dialogs/ExportDialog';
import { ShortcutsDialog } from './ui/dialogs/ShortcutsDialog';
import { ViewSwitcher } from './ui/ViewSwitcher';
import { RackDesigner } from './rack/RackDesigner';
import { DesignerChooser, type DesignerMode } from './ui/DesignerChooser';
import { SettingsDialog } from './ui/dialogs/SettingsDialog';
import { AboutDialog } from './ui/dialogs/AboutDialog';
import { OutlineDialog } from './ui/dialogs/OutlineDialog';
import { UpdateToast } from './ui/UpdateToast';
import { CommandPalette, type PaletteCommand } from './ui/CommandPalette';
import { ValidationAnnouncer } from './ui/ValidationAnnouncer';
import { applyReduceMotion, getReduceMotion } from './lib/prefs';
import { ReadOnlyBanner, ErrorToast, NoticeToast } from './ui/dialogs/ReadOnlyBanner';
import { NexIcon } from './ui/icons/NexIcon';
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
  const [nexText, setNexText] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [mode, setMode] = useState<DesignerMode | null>(() => {
    const m = localStorage.getItem('nexmap.mode');
    return m === 'rack' || m === 'network' ? m : null;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const runValidation = useProjectStore((s) => s.runValidation);
  const newProject = useProjectStore((s) => s.newProject);
  const dirty = useProjectStore((s) => s.dirty);

  const persistence = usePersistence();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paste-to-canvas: clipboard image → underlay, clipboard CSV → model objects.
  usePasteToCanvas();

  // Apply the saved reduced-motion preference on launch.
  useEffect(() => {
    applyReduceMotion(getReduceMotion());
  }, []);

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

  function pickMode(m: DesignerMode) {
    setMode(m);
    localStorage.setItem('nexmap.mode', m);
    // Rack jumps straight into its own empty state; network shows the template start screen.
    setFirstRunDone(m === 'rack');
  }

  function switchDesigner() {
    if (dirty && !confirm('Discard unsaved changes and switch designer?')) return;
    newProject(new Date().toISOString());
    localStorage.removeItem('nexmap.mode');
    setMode(null);
    setFirstRunDone(false);
  }

  async function handleOpen() {
    if (canOpenPicker) await persistence.open();
    else fileInputRef.current?.click();
  }

  const actions = (
    <>
      <button
        className={shell.topbarBtn}
        onClick={handleNew}
        title="New project (Ctrl+N)"
      >
        <NexIcon name="new-file" />
        <span>New</span>
      </button>
      <button
        className={shell.topbarBtn}
        onClick={handleOpen}
        title="Open .nexmap (Ctrl+O)"
      >
        <NexIcon name="open-file" />
        <span>Open</span>
      </button>
      <button
        className={shell.topbarBtn}
        onClick={() => persistence.save()}
        title="Save (Ctrl+S)"
      >
        <NexIcon name="save" />
        <span>Save</span>
      </button>
      {mode === 'network' && (
        <>
          <button
            className={shell.topbarBtn}
            onClick={() => setNexText(true)}
            title="NexText — text to diagram"
          >
            <NexIcon name="text" />
            <span>NexText</span>
          </button>
          <button
            className={shell.topbarBtn}
            onClick={() => setImporting(true)}
            title="Import CSV"
          >
            <NexIcon name="import" />
            <span>Import</span>
          </button>
          <button
            className={shell.topbarBtn}
            onClick={() => setExporting(true)}
            title="Export (Ctrl+E)"
          >
            <NexIcon name="export" />
            <span>Export</span>
          </button>
          <ViewSwitcher />
        </>
      )}
      <button
        className={shell.topbarBtn}
        onClick={doUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <NexIcon name="undo" />
      </button>
      <button
        className={shell.topbarBtn}
        onClick={doRedo}
        disabled={!canRedo}
        title="Redo"
        aria-label="Redo"
      >
        <NexIcon name="redo" />
      </button>
      <button
        className={shell.topbarBtn}
        onClick={switchDesigner}
        title="Switch between the Network and Rack designers"
      >
        <NexIcon name={mode === 'rack' ? 'rack' : 'connect'} />
        <span>{mode === 'rack' ? 'Rack designer' : 'Network designer'}</span>
      </button>
      <details className={shell.moreMenu}>
        <summary className={shell.topbarBtn} title="More actions">
          <NexIcon name="settings" />
          <span>More</span>
        </summary>
        <div className={shell.menuPanel}>
          {mode === 'network' && (
            <>
              <button
                className={shell.menuItem}
                onClick={() => setShowPages((p) => !p)}
                aria-pressed={showPages}
              >
                <NexIcon name="pages" />
                <span>{showPages ? 'Hide pages' : 'Show pages'}</span>
              </button>
              <button className={shell.menuItem} onClick={() => setPresentation(true)}>
                <NexIcon name="presentation" />
                <span>Presentation</span>
              </button>
              <button
                className={shell.menuItem}
                onClick={() => setView((v) => (v === 'editor' ? 'perf' : 'editor'))}
              >
                <NexIcon name="inspector" />
                <span>{view === 'editor' ? 'Performance harness' : 'Editor'}</span>
              </button>
              <button className={shell.menuItem} onClick={() => setShowOutline(true)}>
                <NexIcon name="library" />
                <span>Topology outline</span>
              </button>
            </>
          )}
          <button className={shell.menuItem} onClick={switchDesigner}>
            <NexIcon name="rack" />
            <span>Switch designer…</span>
          </button>
          <button className={shell.menuItem} onClick={toggleTheme}>
            <NexIcon name="theme" />
            <span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
          </button>
          <button className={shell.menuItem} onClick={() => setShowSettings(true)}>
            <NexIcon name="settings" />
            <span>Settings</span>
          </button>
          <button className={shell.menuItem} onClick={() => setShowHelp(true)}>
            <NexIcon name="help" />
            <span>Keyboard shortcuts</span>
          </button>
          <button className={shell.menuItem} onClick={() => setShowAbout(true)}>
            <NexIcon name="help" />
            <span>About &amp; privacy</span>
          </button>
        </div>
      </details>
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
      } else if (k === 'k') {
        e.preventDefault();
        setShowPalette((p) => !p);
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
    const onHelpEvent = () => setShowHelp(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onHelp);
    window.addEventListener('nexmap:help', onHelpEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onHelp);
      window.removeEventListener('nexmap:help', onHelpEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence]);

  // Esc exits presentation mode.
  useEffect(() => {
    if (!presentation) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentation(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [presentation]);

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

  if (presentation) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas-bg)' }}>
        <Canvas readOnly showPages={showPages} />
        <button
          className={shell.topbarBtn}
          onClick={() => setPresentation(false)}
          style={{
            position: 'fixed',
            top: 12,
            right: 12,
            zIndex: 50,
            background: 'var(--chrome-bg)',
          }}
        >
          <NexIcon name="close" />
          <span>Exit presentation (Esc)</span>
        </button>
      </div>
    );
  }

  const showRecovery = !firstRunDone && persistence.recoverable !== null;
  const showFirstRun =
    !firstRunDone && persistence.recoverable === null && mode === 'network';

  // Entry chooser: ask which designer when none is active and nothing to recover.
  if (mode === null && persistence.recoverable === null) {
    return <DesignerChooser onPick={pickMode} onOpen={() => void handleOpen()} />;
  }
  const isRack = mode === 'rack';

  return (
    <AppShell
      actions={actions}
      titleNode={<EditableTitle />}
      fullBleed={isRack}
      left={isRack ? undefined : <LeftPanel />}
      right={isRack ? undefined : <Inspector />}
      canvas={
        <>
          {persistence.readOnly && <ReadOnlyBanner />}
          {isRack ? <RackDesigner /> : <Canvas showPages={showPages} />}
          {showFirstRun && (
            <FirstRun
              onDone={() => setFirstRunDone(true)}
              onOpenText={persistence.openText}
            />
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
          {persistence.notice && (
            <NoticeToast message={persistence.notice} onDismiss={persistence.dismissNotice} />
          )}
          {nexText && <NexTextDialog onClose={() => setNexText(false)} />}
          {importing && <ImportDialog onClose={() => setImporting(false)} />}
          {exporting && <ExportDialog onClose={() => setExporting(false)} />}
          {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
          {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
          {showOutline && <OutlineDialog onClose={() => setShowOutline(false)} />}
          {showSettings && (
            <SettingsDialog
              theme={theme}
              onToggleTheme={toggleTheme}
              onClose={() => setShowSettings(false)}
            />
          )}
          <UpdateToast />
          <ValidationAnnouncer />
          {showPalette &&
            (() => {
              const st = useProjectStore.getState;
              // Commands relevant in both designers.
              const generic: PaletteCommand[] = [
                { id: 'new', label: 'New project', hint: '⌘N', run: handleNew },
                { id: 'open', label: 'Open .nexmap…', hint: '⌘O', run: () => void handleOpen() },
                { id: 'save', label: 'Save', hint: '⌘S', run: () => void persistence.save() },
                { id: 'undo', label: 'Undo', hint: '⌘Z', run: doUndo },
                { id: 'redo', label: 'Redo', hint: '⌘⇧Z', run: doRedo },
                { id: 'switch', label: 'Switch designer…', run: switchDesigner },
                { id: 'theme', label: 'Toggle theme', run: toggleTheme },
                { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', run: () => setShowHelp(true) },
                { id: 'about', label: 'About & privacy', run: () => setShowAbout(true) },
              ];
              // Topology-only commands — hidden in the Rack designer.
              const networkOnly: PaletteCommand[] = [
                { id: 'export', label: 'Export…', hint: '⌘E', run: () => setExporting(true) },
                { id: 'import', label: 'Import…', run: () => setImporting(true) },
                { id: 'nextext', label: 'NexText (describe in text)…', run: () => setNexText(true) },
                { id: 'layout', label: 'Auto-layout (tidy)', run: () => st().autoLayout() },
                {
                  id: 'projection',
                  label: 'Toggle 2D / isometric view',
                  run: () => st().setProjection(st().projection === 'iso' ? 'flat' : 'iso'),
                },
                {
                  id: 'reroute',
                  label: 'Route selected link(s) around obstacles',
                  run: () => st().rerouteSelectedLinks(),
                },
                { id: 'selectall', label: 'Select all', hint: '⌘A', run: () => st().selectAll() },
                { id: 'deselect', label: 'Deselect', run: () => st().clearSelection() },
                { id: 'present', label: 'Presentation mode', run: () => setPresentation(true) },
                { id: 'outline', label: 'Topology outline (accessible list)', run: () => setShowOutline(true) },
              ];
              const cmds: PaletteCommand[] =
                mode === 'rack' ? generic : [...generic.slice(0, 5), ...networkOnly, ...generic.slice(5)];
              return (
                <CommandPalette commands={cmds} onClose={() => setShowPalette(false)} />
              );
            })()}
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
      bottom={isRack ? undefined : <BottomPanel />}
      status={<StatusBar persistence={persistence} mode={mode} />}
    />
  );
}

function StatusBar({
  persistence,
  mode,
}: {
  persistence: ReturnType<typeof usePersistence>;
  mode: DesignerMode | null;
}) {
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
      {/* Validation is a network-topology concern; the rack designer has none. */}
      {mode === 'rack' ? <span>Rack designer</span> : <ValidationSummary />}
    </>
  );
}
