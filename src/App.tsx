import { useEffect, useState } from 'react';
import { AppShell } from './ui/shell/AppShell';
import { Library } from './ui/LeftSidebar/Library';
import { Canvas } from './canvas/Canvas';
import { PerfHarness } from './perf/PerfHarness';
import { useProjectStore } from './store/projectStore';
import { severityRank } from './model/validate';
import shell from './ui/shell/AppShell.module.css';

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('nexmap.theme');
    return stored === 'dark' ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('nexmap.theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

/** Status-bar validation summary — a preview of the M5 wedge UI. */
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

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<'editor' | 'perf'>('editor');
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const runValidation = useProjectStore((s) => s.runValidation);

  // Validation re-runs after undo/redo (live-validation preview ahead of M5).
  function doUndo() {
    undo();
    runValidation();
  }
  function doRedo() {
    redo();
    runValidation();
  }

  const actions = (
    <>
      <button className={shell.topbarBtn} onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        ↶ Undo
      </button>
      <button className={shell.topbarBtn} onClick={doRedo} disabled={!canRedo} title="Redo">
        ↷ Redo
      </button>
      <button
        className={shell.topbarBtn}
        onClick={() => setView((v) => (v === 'editor' ? 'perf' : 'editor'))}
      >
        {view === 'editor' ? 'Perf harness' : 'Back to editor'}
      </button>
      <button className={shell.topbarBtn} onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'light' ? '☽ Dark' : '☀ Light'}
      </button>
    </>
  );

  // Global undo/redo keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <AppShell
      actions={actions}
      left={<Library />}
      canvas={<Canvas />}
      status={
        <>
          <span>Drag a device from the left to start</span>
          <span style={{ marginLeft: 'auto' }} />
          <ValidationSummary />
        </>
      }
    />
  );
}
