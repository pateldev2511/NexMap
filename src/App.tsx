import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AppShell } from './ui/shell/AppShell';
import { MoreMenu } from './ui/shell/MoreMenu';
import { FirstRun, shouldShowFirstRun } from './ui/firstrun/FirstRun';
import { ErrorBoundary } from './ui/shell/ErrorBoundary';
import { RecoveryDialog } from './ui/dialogs/RecoveryDialog';
import { usePasteToCanvas } from './io/import/usePasteToCanvas';
import { ViewSwitcher } from './ui/ViewSwitcher';
import { DesignerChooser, type DesignerMode } from './ui/DesignerChooser';
import { designerFor } from './persistence/draft';
import { UnsavedChangesDialog, type UnsavedChoice } from './ui/dialogs/UnsavedChangesDialog';
import { CommandPalette, type PaletteCommand } from './ui/CommandPalette';
import {
  countedDevices,
  customRuleLabel,
  evaluateCustomRules,
  findRestated,
  hasMinimum,
  isCustomRuleRestorable,
  namingCanGenerate,
  violationTodo,
} from '@/model/invariants';
import { parseRuleIntent } from '@/model/ruleIntent';
import { suggestRules } from '@/model/ruleSuggest';
import { loadRulesFile, saveRulesFile } from '@/ui/rulesFileActions';
import { ruleFixes } from '@/model/ruleStakes';
import type { CustomRuleSpec } from '@/model/types';
import { keyboardRouter } from './input/router';
import { useQuietChrome } from './ui/useQuietChrome';
import { ValidationAnnouncer } from './ui/ValidationAnnouncer';
import {
  applyReduceMotion,
  getReduceMotion,
  applyMotionLevel,
  getMotionLevel,
  readPref,
  writePref,
} from './lib/prefs';
import { installTooltips } from './ui/tooltip';
import {
  ReadOnlyBanner,
  ReadOnlyGate,
  ErrorToast,
  NoticeToast,
} from './ui/dialogs/ReadOnlyBanner';
import { NexIcon } from './ui/icons/NexIcon';
import { useProjectStore } from './store/projectStore';
import {
  usePersistence,
  type ConfirmReplace,
  type PickedFile,
} from './persistence/usePersistence';
import { canOpenPicker } from './persistence/fsaccess';
import { severityRank } from './model/validate';
import { defaultDeviceName } from './model/schema';
import { QUICK_CREATE_TYPES } from './canvas/QuickCreateMenu';
import { TEMPLATES } from './model/templates';
import shell from './ui/shell/AppShell.module.css';

// Code-split (#44). The launch screen needs none of these: each designer, the
// network panels, the perf harness and every on-demand dialog load as their own
// chunks. They are prefetched once the launch screen is idle (prefetchEditor), so
// picking a designer doesn't wait on the network, and the service worker precaches
// every chunk, so they open offline too.
const loadCanvas = () => import('./canvas/Canvas');
const loadRack = () => import('./rack/RackDesigner');
const loadLeft = () => import('./ui/LeftSidebar/LeftPanel');
const loadInspector = () => import('./ui/Inspector/Inspector');
const loadBottom = () => import('./ui/BottomPanel/BottomPanel');
const Canvas = lazy(() => loadCanvas().then((m) => ({ default: m.Canvas })));
const RackDesigner = lazy(() => loadRack().then((m) => ({ default: m.RackDesigner })));
const LeftPanel = lazy(() => loadLeft().then((m) => ({ default: m.LeftPanel })));
const Inspector = lazy(() => loadInspector().then((m) => ({ default: m.Inspector })));
const BottomPanel = lazy(() => loadBottom().then((m) => ({ default: m.BottomPanel })));
const PerfHarness = lazy(() =>
  import('./perf/PerfHarness').then((m) => ({ default: m.PerfHarness })),
);
const ImportDialog = lazy(() =>
  import('./ui/dialogs/ImportDialog').then((m) => ({ default: m.ImportDialog })),
);
const ExportDialog = lazy(() =>
  import('./ui/dialogs/ExportDialog').then((m) => ({ default: m.ExportDialog })),
);
const NexTextDialog = lazy(() =>
  import('./ui/dialogs/NexTextDialog').then((m) => ({ default: m.NexTextDialog })),
);
const ShortcutsDialog = lazy(() =>
  import('./ui/dialogs/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })),
);
const SettingsDialog = lazy(() =>
  import('./ui/dialogs/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
const AboutDialog = lazy(() =>
  import('./ui/dialogs/AboutDialog').then((m) => ({ default: m.AboutDialog })),
);
const OutlineDialog = lazy(() =>
  import('./ui/dialogs/OutlineDialog').then((m) => ({ default: m.OutlineDialog })),
);

/** Warm both designers' chunks in idle time, once per page. */
let prefetched = false;
function prefetchEditor(): void {
  if (prefetched) return;
  prefetched = true;
  const go = () => {
    // Both designers' main chunks first, so either tile is ready soonest.
    for (const load of [loadCanvas, loadRack, loadLeft, loadInspector, loadBottom])
      void load().catch(() => {});
  };
  // Soon after the launch screen paints: on a slow link the chunks need that head
  // start to be there by the time someone has picked a designer.
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 200 });
  else setTimeout(go, 50);
}

// A returning visitor skips the launch screen into their last designer: start that
// chunk now, in parallel with the first render, rather than after it.
{
  const remembered = readPref('nexmap.mode');
  if (remembered === 'rack') void loadRack().catch(() => {});
  else if (remembered === 'network')
    for (const load of [loadCanvas, loadLeft, loadInspector, loadBottom]) void load().catch(() => {});
}

/** What the canvas area shows while a designer's chunk is still arriving. */
function DesignerLoading() {
  return (
    <div
      role="status"
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        color: 'var(--chrome-fg-muted)',
        fontSize: 13,
      }}
    >
      Loading designer…
    </div>
  );
}

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    readPref('nexmap.theme') === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePref('nexmap.theme', theme);
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
  const readOnly = useProjectStore((s) => s.readOnly);
  return (
    <div className={shell.titleEdit}>
      <input
        className={shell.titleInput}
        value={name}
        aria-label="Project name"
        readOnly={readOnly}
        onChange={(e) => {
          if (!readOnly) rename(name, e.target.value);
        }}
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
    const m = readPref('nexmap.mode');
    return m === 'rack' || m === 'network' ? m : null;
  });
  /** The open save/discard/cancel question, if any (#19). */
  const [unsavedAsk, setUnsavedAsk] = useState<{
    action: string;
    resolve: (choice: UnsavedChoice) => void;
  } | null>(null);
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
  const flash = useProjectStore((s) => s.flash);
  const docRevision = useProjectStore((s) => s.docRevision);

  const persistence = usePersistence();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paste-to-canvas: clipboard image → underlay, clipboard CSV → model objects.
  usePasteToCanvas();

  // Apply the saved motion preferences on launch.
  useEffect(() => {
    applyReduceMotion(getReduceMotion());
    applyMotionLevel(getMotionLevel());
  }, []);

  // Hover/focus tooltips: one body-level singleton that auto-covers every control
  // carrying a title (migrated to data-tip on first hover). Immune to overflow clip.
  useEffect(() => installTooltips(), []);

  // Auto-dismiss the transient Conductor result banner after a few seconds.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => useProjectStore.getState().setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

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

  /**
   * Asked before a different document replaces the open one (#19): nothing to
   * ask when it's saved; otherwise Save (and go ahead only if that worked),
   * Discard (the pending autosave goes too), or Cancel (keep everything).
   */
  function confirmReplace(action: string): ConfirmReplace {
    return async () => {
      if (!useProjectStore.getState().dirty) return true;
      const choice = await new Promise<UnsavedChoice>((resolve) =>
        setUnsavedAsk({ action, resolve }),
      );
      if (choice === 'cancel') return false;
      if (choice === 'discard') {
        persistence.dropPendingAutosave();
        return true;
      }
      return persistence.save();
    };
  }

  async function handleNew() {
    if (persistence.readOnly) return;
    if (!(await confirmReplace('starting a new project')())) return;
    newProject(new Date().toISOString());
    setFirstRunDone(true);
  }

  function pickMode(m: DesignerMode) {
    setMode(m);
    writePref('nexmap.mode', m);
    // Rack jumps straight into its own empty state; network shows the template start screen.
    setFirstRunDone(m === 'rack');
  }

  /**
   * Same project, other designer (#54): the document, undo history, file and
   * draft all carry over — both designers edit one .nexmap. Starting a different
   * project is New. The launch chooser still offers either designer standalone.
   */
  function switchDesigner() {
    const next: DesignerMode = mode === 'rack' ? 'network' : 'rack';
    setMode(next);
    writePref('nexmap.mode', next);
    // Never cover the open project with the template gallery — but a pending
    // recovery decision stays up.
    if (!persistence.recoverable) setFirstRunDone(true);
  }

  /** A document was just opened: show it, in a designer that suits it from the launch screen. */
  function enterOpened() {
    setFirstRunDone(true);
    if (mode === null) {
      const m = designerFor(useProjectStore.getState().getDocument());
      setMode(m);
      writePref('nexmap.mode', m);
    }
  }

  async function openPicked(file: PickedFile) {
    if (await persistence.openFile(file, confirmReplace('opening another file'))) enterOpened();
  }

  /**
   * Open (toolbar, ⌘O, palette, launch screen): the native picker where there is
   * one, else the hidden file input — mounted on the launch screen too (#23).
   * The file is chosen and validated first; only a sound file prompts or replaces.
   */
  async function handleOpen() {
    if (persistence.readOnly) return;
    if (canOpenPicker) {
      const picked = await persistence.pickFile();
      if (picked) await openPicked(picked);
    } else fileInputRef.current?.click();
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".nexmap,.json,application/json"
      style={{ display: 'none' }}
      data-testid="open-file-input"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) await openPicked({ text: await file.text(), handle: null, fileName: file.name });
      }}
    />
  );

  const unsavedDialog = unsavedAsk && (
    <UnsavedChangesDialog
      projectName={useProjectStore.getState().projectName}
      action={unsavedAsk.action}
      onChoose={(choice) => {
        setUnsavedAsk(null);
        unsavedAsk.resolve(choice);
      }}
    />
  );

  const readOnly = persistence.readOnly;

  // View-only second tab (#24): editing shortcuts stop here, before the canvas
  // or app stages see them. Save a copy (⌘S), export, the command menu, help and
  // Esc still work; Tab and other plain keys keep their native behavior.
  useEffect(() => {
    if (!readOnly) return;
    return keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape' || e.key === '?') return false;
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 's' || k === 'e' || k === 'k') return false;
        e.preventDefault();
      }
      return true;
    });
  }, [readOnly]);

  const actions = (
    <>
      <button
        className={shell.topbarBtn}
        onClick={() => void handleNew()}
        disabled={readOnly}
        title="New project (Alt+N)"
      >
        <NexIcon name="new-file" />
        <span>New</span>
      </button>
      <button
        className={shell.topbarBtn}
        onClick={() => void handleOpen()}
        disabled={readOnly}
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
            disabled={readOnly}
            title="NexText — text to diagram"
          >
            <NexIcon name="text" />
            <span>NexText</span>
          </button>
          <button
            className={shell.topbarBtn}
            onClick={() => setImporting(true)}
            disabled={readOnly}
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
        disabled={!canUndo || readOnly}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <NexIcon name="undo" />
      </button>
      <button
        className={shell.topbarBtn}
        onClick={doRedo}
        disabled={!canRedo || readOnly}
        title="Redo"
        aria-label="Redo"
      >
        <NexIcon name="redo" />
      </button>
      <button
        className={shell.topbarBtn}
        onClick={switchDesigner}
        title={`Open this project in the ${mode === 'rack' ? 'Network' : 'Rack'} designer`}
        aria-label="Switch designer"
      >
        <NexIcon name={mode === 'rack' ? 'rack' : 'connect'} />
        <span>{mode === 'rack' ? 'Rack designer' : 'Network designer'}</span>
      </button>
      <button
        className={shell.topbarBtn}
        onClick={() => setShowPalette(true)}
        title="Command menu (⌘K)"
        aria-label="Open command menu"
      >
        <NexIcon name="search" />
        <span>Command</span>
      </button>
      <MoreMenu>
        {(close) => (
          <>
            {mode === 'network' && (
              <>
                <button
                  className={shell.menuItem}
                  onClick={() => { setShowPages((p) => !p); close(); }}
                  aria-pressed={showPages}
                >
                  <NexIcon name="pages" />
                  <span>{showPages ? 'Hide pages' : 'Show pages'}</span>
                </button>
                <button className={shell.menuItem} onClick={() => { setPresentation(true); close(); }}>
                  <NexIcon name="presentation" />
                  <span>Presentation</span>
                </button>
                <button
                  className={shell.menuItem}
                  onClick={() => { setView((v) => (v === 'editor' ? 'perf' : 'editor')); close(); }}
                >
                  <NexIcon name="inspector" />
                  <span>{view === 'editor' ? 'Performance harness' : 'Editor'}</span>
                </button>
                <button className={shell.menuItem} onClick={() => { setShowOutline(true); close(); }}>
                  <NexIcon name="library" />
                  <span>Topology outline</span>
                </button>
              </>
            )}
            <button className={shell.menuItem} onClick={() => { switchDesigner(); close(); }}>
              <NexIcon name="rack" />
              <span>{mode === 'rack' ? 'Open in Network designer' : 'Open in Rack designer'}</span>
            </button>
            <button className={shell.menuItem} onClick={() => { toggleTheme(); close(); }}>
              <NexIcon name="theme" />
              <span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
            </button>
            <button className={shell.menuItem} onClick={() => { setShowSettings(true); close(); }}>
              <NexIcon name="settings" />
              <span>Settings</span>
            </button>
            <button className={shell.menuItem} onClick={() => { setShowHelp(true); close(); }}>
              <NexIcon name="help" />
              <span>Keyboard shortcuts</span>
            </button>
            <button className={shell.menuItem} onClick={() => { setShowAbout(true); close(); }}>
              <NexIcon name="help" />
              <span>About &amp; privacy</span>
            </button>
          </>
        )}
      </MoreMenu>
    </>
  );

  // App-shortcut stage of the shared keyboard router (one window listener
  // app-wide). Text fields never reach this — Cmd+Z while typing is native
  // text undo, not model undo — and Cmd+Z mid-drag is consumed by the
  // router's gesture-cancel stage before it can pop history.
  useQuietChrome(); // M3c: earned-quiet chrome demotion driver
  const presentingRef = useRef(presentation);
  presentingRef.current = presentation;
  // The registered handler outlives renders; reach the current handleNew (it
  // reads `dirty` for the unsaved-work confirm) rather than a stale capture.
  const handleNewRef = useRef(handleNew);
  handleNewRef.current = handleNew;
  useEffect(() => {
    keyboardRouter.install();
    const unregister = keyboardRouter.registerApp((e) => {
      // Presenting is read-only (#35): no undo/redo or open, and no editor-only
      // overlays (export, palette, help) opening unseen behind it. Swallowed so the
      // browser's own ⌘O / ⌘K don't fire either. Save still works.
      if (presentingRef.current) {
        const k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && ['z', 'o', 'e', 'k'].includes(k)) {
          e.preventDefault();
          return true;
        }
        if (e.key === '?' || (e.altKey && e.code === 'KeyN')) return true;
      }
      // New project: Alt/Option+N (#56). ⌘N/Ctrl+N is the browser's New Window and
      // can't be intercepted, so it isn't offered. Matched by code: Option+N on
      // macOS is a dead key (e.key is 'Dead'/'˜'), not 'n'.
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyN') {
        e.preventDefault();
        void handleNewRef.current();
        return true;
      }
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) doRedo();
          else doUndo();
          return true;
        }
        if (k === 's') {
          e.preventDefault();
          void persistence.save();
          return true;
        }
        if (k === 'o') {
          e.preventDefault();
          void handleOpen();
          return true;
        }
        if (k === 'e') {
          e.preventDefault();
          setExporting(true);
          return true;
        }
        if (k === 'k') {
          e.preventDefault();
          setShowPalette((p) => !p);
          return true;
        }
        return false;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(true);
        return true;
      }
      return false;
    });
    const onHelpEvent = () => setShowHelp(true);
    window.addEventListener('nexmap:help', onHelpEvent);
    return () => {
      unregister();
      window.removeEventListener('nexmap:help', onHelpEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence]);

  // Esc exits presentation mode — an OVERLAY, the innermost Escape layer.
  useEffect(() => {
    if (!presentation) return;
    return keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape') {
        setPresentation(false);
        return true;
      }
      return false;
    });
  }, [presentation]);

  if (view === 'perf') {
    return (
      <AppShell
        actions={actions}
        projectName="M0 SVG perf harness"
        canvas={
          <Suspense fallback={<DesignerLoading />}>
            <PerfHarness />
          </Suspense>
        }
        status={<span>M0 benchmark — drives the M2 renderer decision</span>}
      />
    );
  }

  if (presentation) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas-bg)' }}>
        <ErrorBoundary
          label="presentation"
          extraActions={
            <button type="button" className={shell.topbarBtn} onClick={() => setPresentation(false)}>
              Exit presentation
            </button>
          }
        >
          <Suspense fallback={<DesignerLoading />}>
            <Canvas readOnly showPages={showPages} />
          </Suspense>
        </ErrorBoundary>
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
  const showFirstRun = shouldShowFirstRun({
    done: firstRunDone,
    docRevision,
    recoverable: persistence.recoverable !== null,
    mode,
  });

  // Entry chooser: ask which designer whenever none is active. This must NOT
  // also require `recoverable === null` — a lingering autosave draft used to
  // bypass the chooser and fall through to `isRack = false`, silently
  // rendering the Network Designer. So picking Rack after a switch-designer
  // with a draft present landed you in Network. The chooser owns the
  // mode===null state; the recovery prompt appears inside whichever designer
  // is then chosen.
  if (mode === null) {
    prefetchEditor();
    return (
      <>
        <DesignerChooser
          onPick={pickMode}
          onOpen={() => void handleOpen()}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        {/* The fallback input and an Open failure live on the launch screen too (#23). */}
        {fileInput}
        {persistence.error && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
            <ErrorToast message={persistence.error} />
          </div>
        )}
        {unsavedDialog}
      </>
    );
  }
  const isRack = mode === 'rack';

  return (
    <AppShell
      actions={actions}
      titleNode={<EditableTitle />}
      fullBleed={isRack}
      left={
        isRack ? undefined : (
          <ReadOnlyGate on={readOnly}>
            <Suspense fallback={null}>
              <LeftPanel />
            </Suspense>
          </ReadOnlyGate>
        )
      }
      right={
        isRack ? undefined : (
          <ReadOnlyGate on={readOnly}>
            <Suspense fallback={null}>
              <Inspector />
            </Suspense>
          </ReadOnlyGate>
        )
      }
      canvas={
        <>
          {readOnly && <ReadOnlyBanner />}
          <Suspense fallback={<DesignerLoading />}>
            {isRack ? (
              <ReadOnlyGate on={readOnly}>
                <RackDesigner />
              </ReadOnlyGate>
            ) : (
              <Canvas showPages={showPages} readOnly={readOnly} />
            )}
          </Suspense>
          {showFirstRun && (
            <FirstRun
              onDone={() => setFirstRunDone(true)}
              onBlank={() => setFirstRunDone(true)}
              onOpenText={(text) =>
                persistence.openText(text, confirmReplace('opening another file'))
              }
            />
          )}
          {showRecovery && persistence.recoverable && (
            <RecoveryDialog
              draft={persistence.recoverable}
              onRecover={() => {
                if (persistence.recover()) setFirstRunDone(true);
              }}
              onDiscard={() => {
                persistence.discardDraft();
              }}
              discardBlocked={
                readOnly ? 'Open in another tab — close it to discard here.' : undefined
              }
            />
          )}
          {persistence.error && <ErrorToast message={persistence.error} />}
          {persistence.notice && (
            <NoticeToast message={persistence.notice} onDismiss={persistence.dismissNotice} />
          )}
          {flash && (
            <NoticeToast message={flash} onDismiss={() => useProjectStore.getState().setFlash(null)} />
          )}
          <Suspense fallback={null}>
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
          </Suspense>
          <ValidationAnnouncer />
          {showPalette &&
            (() => {
              const st = useProjectStore.getState;
              // Commands relevant in both designers.
              const generic: PaletteCommand[] = [
                { id: 'new', label: 'New project', hint: '⌥N', group: 'File', run: () => void handleNew() },
                { id: 'open', label: 'Open .nexmap…', hint: '⌘O', group: 'File', run: () => void handleOpen() },
                { id: 'save', label: 'Save', hint: '⌘S', group: 'File', run: () => void persistence.save() },
                { id: 'undo', label: 'Undo', hint: '⌘Z', group: 'Edit', run: doUndo },
                { id: 'redo', label: 'Redo', hint: '⌘⇧Z', group: 'Edit', run: doRedo },
                {
                  id: 'switch',
                  label: mode === 'rack' ? 'Open in Network designer' : 'Open in Rack designer',
                  hint: 'same project',
                  group: 'View',
                  run: switchDesigner,
                },
                { id: 'theme', label: 'Toggle theme', group: 'View', run: toggleTheme },
                { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', group: 'View', run: () => setShowHelp(true) },
                { id: 'about', label: 'About & privacy', group: 'View', run: () => setShowAbout(true) },
              ];
              // Conductor (slice 1): summon a device by name. Type its name in the
              // palette and it appears, selected, with the view jumped to it — the
              // declarative "type to create" flow, unified with the one Cmd+K surface
              // (no second type-driven modal, per the design review).
              const deviceSummon: PaletteCommand[] = QUICK_CREATE_TYPES.map((t) => ({
                id: `add-${t}`,
                label: `Add ${defaultDeviceName(t)}`,
                hint: 'device',
                group: 'Build',
                // Summon-at-cursor: lands where you're looking and auto-wires to the
                // nearest node — the store owns placement + wiring (one undo).
                run: () => st().summonDevice(t),
              }));
              // Conductor: scaffold a whole topology into the current diagram, at the
              // viewport, reusing the curated starter registry (blank is just "new").
              const templateInserts: PaletteCommand[] = TEMPLATES.filter(
                (tpl) => tpl.key !== 'blank',
              ).map((tpl) => ({
                id: `template-${tpl.key}`,
                label: `Insert: ${tpl.name}`,
                hint: 'template',
                group: 'Build',
                run: () => st().insertTemplate(tpl.key),
              }));
              // Topology-only commands — hidden in the Rack designer.
              const selCount = st().selection.size;
              // Conductor, proactive: how many changes each safe fixer would make on
              // the current design. A fix that would do something jumps to a
              // "Suggested" group at the top of the palette with its live count; the
              // rest sit quietly under "Repair". Snapshot at open, like selCount.
              const fixCounts = st().conductorFixCounts();
              const n = (id: string) => fixCounts[id] ?? 0;
              const fixGroup = (id: string) => (n(id) > 0 ? 'Suggested' : 'Repair');
              const totalFixable = Object.values(fixCounts).reduce((a, b) => a + b, 0);
              // Declarative invariants by intent: declare/retract each built-in rule
              // from ⌘K (hint = its live status), and — when declared rules are broken
              // and have a remedy — a Suggested "Restore" that brings the design back
              // into compliance without opening the Rules panel.
              const invariants = st().invariantsAll();
              const invEnabled = st().invariantsEnabled;
              const invViolations = st().invariantViolations;
              const restorableIds = new Set([
                ...invariants.filter((i) => i.restorable).map((i) => i.id),
                ...st().customRules.filter(isCustomRuleRestorable).map((r) => r.id),
              ]);
              const brokenRestorable = invViolations.filter((v) => restorableIds.has(v.id)).length;
              const ruleCommands: PaletteCommand[] = invariants.map((inv) => {
                const on = invEnabled.has(inv.id);
                const v = invViolations.find((x) => x.id === inv.id);
                return {
                  id: `rule-${inv.id}`,
                  label: `${on ? 'Retract' : 'Declare'} rule: ${inv.label}`,
                  hint: !on ? 'not declared' : v ? violationTodo(v) : 'met',
                  group: 'Rules',
                  run: () => st().toggleInvariant(inv.id),
                };
              });
              // Authored rules too: retract one by name (re-declare by typing it again).
              for (const r of st().customRules) {
                const v = invViolations.find((x) => x.id === r.id);
                ruleCommands.push({
                  id: `rule-custom-${r.id}`,
                  label: `Retract rule: ${customRuleLabel(r)}`,
                  hint: v ? violationTodo(v) : 'met',
                  group: 'Rules',
                  run: () => st().removeCustomRule(r.id),
                });
              }
              // What the design already does, offered as rules to lock in.
              for (const sg of suggestRules(
                st().ruleContext(),
                { invariants: invEnabled, customRules: st().customRules },
              )) {
                ruleCommands.push({
                  id: `rule-suggest-${sg.key}`,
                  label: `Lock in rule: ${sg.label}`,
                  hint: 'true now',
                  group: 'Rules',
                  run: () =>
                    sg.builtInId
                      ? st().toggleInvariant(sg.builtInId)
                      : st().addCustomRule(sg.rule!.kind, sg.rule!.fromRole, sg.rule!.target, sg.rule!.min),
                });
              }
              // Quick fixes for broken connectivity / isolation rules, by name — and all
              // of them at once when there's more than one.
              const fixes = ruleFixes(
                st().ruleContext(),
                { invariants: invEnabled, customRules: st().customRules },
                { max: 20 },
              );
              if (fixes.length > 1) {
                ruleCommands.push({
                  id: 'rule-fix-all',
                  label: `Apply all ${fixes.length} rule fixes`,
                  hint: 'one undo step',
                  group: 'Rules',
                  run: () => st().applyAllRuleFixes(),
                });
              }
              for (const f of fixes) {
                ruleCommands.push({
                  id: `rule-fix-${f.key}`,
                  label:
                    f.kind === 'connect'
                      ? `Connect ${f.deviceName} to ${f.targetName}`
                      : `Cut ${f.linkLabel}`,
                  hint: `fixes ${f.ruleLabel}`,
                  group: 'Rules',
                  run: () => st().applyRuleFix(f),
                });
              }
              // Carry rules between designs.
              if (invEnabled.size + st().customRules.length > 0) {
                ruleCommands.push({
                  id: 'rules-save',
                  label: 'Save rules as file…',
                  hint: '.nexrules',
                  group: 'Rules',
                  run: saveRulesFile,
                });
              }
              ruleCommands.push({
                id: 'rules-load',
                label: 'Load rules from a file…',
                hint: '.nexrules or .nexmap',
                group: 'Rules',
                run: loadRulesFile,
              });
              if (brokenRestorable > 0) {
                ruleCommands.unshift({
                  id: 'restore-rules',
                  label: `Restore ${brokenRestorable} declared rule${brokenRestorable === 1 ? '' : 's'}`,
                  hint: 'runs each broken rule’s remedy in order',
                  group: 'Suggested',
                  run: () => st().restoreAllInvariants(),
                });
              }
              const networkOnly: PaletteCommand[] = [
                ...deviceSummon,
                ...templateInserts,
                {
                  id: 'weave',
                  label: 'Weave selection into a fabric (auto-connect)',
                  hint: selCount >= 2 ? `${selCount} selected` : 'select 2+',
                  disabled: selCount < 2,
                  group: 'Connect',
                  run: () => st().weaveFabric(),
                },
                {
                  id: 'hub',
                  label: 'Wire selection to its hub (star)',
                  hint: selCount >= 2 ? `${selCount} selected` : 'select spokes + 1 switch/router',
                  disabled: selCount < 2,
                  group: 'Connect',
                  run: () => st().wireToHub(),
                },
                {
                  id: 'auto-ip',
                  label: 'Auto-assign IP addresses',
                  hint: 'IPAM',
                  group: 'Address',
                  run: () => st().autoAddressDevices(),
                },
                {
                  id: 'segment',
                  label: 'Segment selection into a subnet',
                  hint: selCount >= 1 ? `${selCount} selected` : 'select devices',
                  disabled: selCount < 1,
                  group: 'Address',
                  run: () => st().segmentSelection(),
                },
                {
                  id: 'uplink',
                  label: 'Connect to the internet (uplink)',
                  hint: 'wires your firewall/router to an ISP',
                  group: 'Connect',
                  run: () => st().connectToInternet(),
                },
                {
                  id: 'redundant',
                  label: 'Add a redundant twin (fix a single point of failure)',
                  hint: selCount === 1 ? 'clones the selected device' : 'select one device',
                  disabled: selCount !== 1,
                  group: 'Resilience',
                  run: () => st().addRedundantTwin(),
                },
                {
                  id: 'scan-spof',
                  label: 'Scan for single points of failure',
                  hint: 'selects every weak device',
                  group: 'Resilience',
                  run: () => st().scanWeakPoints(),
                },
                {
                  id: 'harden',
                  label: 'Harden the design (twin every single point of failure)',
                  hint: 'adds a redundant twin to each weak device',
                  group: 'Resilience',
                  run: () => st().hardenDesign(),
                },
                {
                  id: 'assign-gateways',
                  label: n('assign-gateways') > 0
                    ? `Assign gateways to ${n('assign-gateways')} subnet${n('assign-gateways') === 1 ? '' : 's'}`
                    : 'Assign gateways to subnets',
                  hint: 'adopts an in-range router/firewall per subnet',
                  group: fixGroup('assign-gateways'),
                  run: () => st().assignGateways(),
                },
                {
                  id: 'dedupe-ips',
                  label: n('dedupe-ips') > 0
                    ? `Resolve ${n('dedupe-ips')} duplicate IP address${n('dedupe-ips') === 1 ? '' : 'es'}`
                    : 'Resolve duplicate IP addresses',
                  hint: 're-addresses devices that share an address',
                  group: fixGroup('dedupe-ips'),
                  run: () => st().deduplicateIps(),
                },
                {
                  id: 'cover-orphans',
                  label: n('cover-orphans') > 0
                    ? `Draw ${n('cover-orphans')} subnet${n('cover-orphans') === 1 ? '' : 's'} to cover orphan addresses`
                    : 'Draw subnets to cover orphan addresses',
                  hint: 'adds a /24 for IPs outside every subnet',
                  group: fixGroup('cover-orphans'),
                  run: () => st().coverOrphanIps(),
                },
                {
                  id: 'addr-ifaces',
                  label: 'Auto-address interfaces',
                  hint: 'gives each port an IP from its device’s subnet',
                  group: 'Address',
                  run: () => st().autoAddressInterfaces(),
                },
                {
                  id: 'dedupe-names',
                  label: n('dedupe-names') > 0
                    ? `Resolve ${n('dedupe-names')} duplicate device name${n('dedupe-names') === 1 ? '' : 's'}`
                    : 'Resolve duplicate device names',
                  hint: 'renames devices that share a name',
                  group: fixGroup('dedupe-names'),
                  run: () => st().deduplicateNames(),
                },
                {
                  id: 'dedupe-vlans',
                  label: n('dedupe-vlans') > 0
                    ? `Resolve ${n('dedupe-vlans')} duplicate VLAN ID${n('dedupe-vlans') === 1 ? '' : 's'}`
                    : 'Resolve duplicate VLAN IDs',
                  hint: 'renumbers VLANs that share an 802.1Q ID',
                  group: fixGroup('dedupe-vlans'),
                  run: () => st().deduplicateVlans(),
                },
                {
                  id: 'name-unnamed',
                  label: n('name-unnamed') > 0
                    ? `Name ${n('name-unnamed')} unnamed device${n('name-unnamed') === 1 ? '' : 's'}`
                    : 'Name unnamed devices',
                  hint: 'labels blank devices from their type',
                  group: fixGroup('name-unnamed'),
                  run: () => st().nameUnnamedDevices(),
                },
                {
                  id: 'prune-links',
                  label: n('prune-links') > 0
                    ? `Prune ${n('prune-links')} dangling link${n('prune-links') === 1 ? '' : 's'}`
                    : 'Prune dangling links',
                  hint: 'removes links that point at a missing device',
                  group: fixGroup('prune-links'),
                  run: () => st().pruneDanglingLinks(),
                },
                {
                  id: 'clear-ifaces',
                  label: n('clear-ifaces') > 0
                    ? `Clear ${n('clear-ifaces')} dangling interface reference${n('clear-ifaces') === 1 ? '' : 's'}`
                    : 'Clear dangling interface references',
                  hint: 'drops link ports that no longer exist',
                  group: fixGroup('clear-ifaces'),
                  run: () => st().clearDanglingIfaces(),
                },
                {
                  id: 'fix-all',
                  label: totalFixable > 0
                    ? `Fix all ${totalFixable} safe issue${totalFixable === 1 ? '' : 's'}`
                    : 'Fix all safe issues',
                  hint: 'runs every automatic Conductor remedy at once',
                  group: totalFixable > 0 ? 'Suggested' : 'Repair',
                  run: () => st().fixAllSafeIssues(),
                },
                ...ruleCommands,
                { id: 'export', label: 'Export…', hint: '⌘E', group: 'File', run: () => setExporting(true) },
                { id: 'import', label: 'Import…', group: 'File', run: () => setImporting(true) },
                { id: 'nextext', label: 'NexText (describe in text)…', group: 'Build', run: () => setNexText(true) },
                { id: 'layout', label: 'Auto-layout (tidy)', group: 'View', run: () => st().autoLayout() },
                {
                  id: 'layout-by-site',
                  label: 'Auto-layout by site',
                  hint: "uses each device's Location",
                  group: 'View',
                  run: () => st().autoLayoutBySite(),
                },
                {
                  id: 'projection',
                  label: 'Toggle 2D / isometric view',
                  group: 'View',
                  run: () => st().setProjection(st().projection === 'iso' ? 'flat' : 'iso'),
                },
                {
                  id: 'blueprint',
                  label: st().projection === 'blueprint' ? 'Leave blueprint view' : 'Blueprint view',
                  hint: 'the diagram as a drafting sheet',
                  group: 'View',
                  run: () =>
                    st().setProjection(st().projection === 'blueprint' ? 'flat' : 'blueprint'),
                },
                {
                  id: 'reroute',
                  label: 'Route selected link(s) around obstacles',
                  group: 'View',
                  run: () => st().rerouteSelectedLinks(),
                },
                { id: 'selectall', label: 'Select all', hint: '⌘A', group: 'Edit', run: () => st().selectAll() },
                { id: 'deselect', label: 'Deselect', group: 'Edit', run: () => st().clearSelection() },
                { id: 'present', label: 'Presentation mode', group: 'View', run: () => setPresentation(true) },
                { id: 'outline', label: 'Topology outline (accessible list)', group: 'View', run: () => setShowOutline(true) },
              ];
              // A view-only tab (#24) offers only what doesn't edit the project.
              const VIEW_SAFE = new Set(['save', 'switch', 'theme', 'shortcuts', 'about']);
              const cmds: PaletteCommand[] = readOnly
                ? generic.filter((c) => VIEW_SAFE.has(c.id))
                : mode === 'rack'
                  ? generic
                  : [...generic.slice(0, 5), ...networkOnly, ...generic.slice(5)];
              // Declare a rule by saying it: when the query reads as a custom rule
              // ("every camera lives in CCTV"), offer it first, with a live preview of
              // what it would flag. An identical rule already declared is shown, disabled.
              const ruleIntent = (q: string): PaletteCommand[] => {
                const roles = [
                  ...new Set(st().devicesAll().map((d) => d.role?.trim()).filter((r): r is string => !!r)),
                ];
                const subnetRefs = st()
                  .subnetsAll()
                  .flatMap((sn) => (sn.name?.trim() ? [sn.name.trim(), sn.cidr] : [sn.cidr]));
                const r = parseRuleIntent(q, roles, subnetRefs);
                if (!r) return [];
                const spec: CustomRuleSpec = {
                  id: 'intent-preview',
                  kind: r.kind,
                  fromRole: r.fromRole,
                  toRole: r.kind === 'placement' || r.kind === 'count' || r.kind === 'naming' ? '' : r.target,
                  min: r.min,
                  ...(r.kind === 'placement' ? { subnet: r.target } : {}),
                  ...(r.kind === 'naming' ? { pattern: r.target } : {}),
                };
                const same = (a: string | undefined, b: string | undefined) =>
                  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
                const exists = st().customRules.some(
                  (x) =>
                    x.kind === spec.kind &&
                    same(x.fromRole, spec.fromRole) &&
                    same(x.toRole, spec.toRole) &&
                    same(x.subnet, spec.subnet) &&
                    (x.pattern ?? '') === (spec.pattern ?? '') &&
                    x.min === spec.min,
                );
                const preview = evaluateCustomRules([spec], st().ruleContext())[0];
                // Same rule, new number ("at least 3 firewalls" over "at least 2"):
                // offer to change the declared one instead of adding a second.
                const restated = !exists && hasMinimum(spec.kind) ? findRestated(st().customRules, spec) : undefined;
                return [
                  {
                    id: 'intent-rule',
                    label: restated
                      ? `Change rule: ${customRuleLabel(spec)} (was ${restated.min})`
                      : `Declare rule: ${customRuleLabel(spec)}`,
                    // "met now" only when the rule actually checks something: a role no
                    // device carries yet is vacuously met, so say so (catches typos too).
                    // A count rule isn't vacuous with none present — it's short.
                    hint: exists
                      ? 'already declared'
                      : r.kind === 'naming'
                        ? countedDevices(r.fromRole, st().devicesAll()).length === 0
                          ? `no “${r.fromRole}” devices yet`
                          : preview
                            ? `${violationTodo(preview)}${namingCanGenerate(r.target) ? ' — Restore can rename' : ''}`
                            : 'met now'
                      : r.kind !== 'count' && !roles.some((x) => x.toLowerCase() === r.fromRole.toLowerCase())
                        ? `no “${r.fromRole}” devices yet`
                        : preview
                          ? violationTodo(preview)
                          : 'met now',
                    disabled: exists,
                    run: () => st().addCustomRule(r.kind, r.fromRole, r.target, r.min),
                  },
                ];
              };
              return (
                <CommandPalette
                  commands={cmds}
                  intent={readOnly ? () => [] : ruleIntent}
                  onClose={() => setShowPalette(false)}
                />
              );
            })()}
          {fileInput}
          {unsavedDialog}
        </>
      }
      bottom={
        isRack ? undefined : (
          <ReadOnlyGate on={readOnly}>
            <Suspense fallback={null}>
              <BottomPanel />
            </Suspense>
          </ReadOnlyGate>
        )
      }
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
