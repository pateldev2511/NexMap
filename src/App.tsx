import { useEffect, useState } from 'react';
import { AppShell } from './ui/shell/AppShell';
import { PerfHarness } from './perf/PerfHarness';
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

/** Empty-canvas hint (design review DA-DES-1.3). The real first-run flow lands in M3. */
function CanvasPlaceholder() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--chrome-fg-muted)',
        textAlign: 'center',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--chrome-fg)' }}>
          Your canvas is empty
        </div>
        Drag a device from the left, or press <kbd>/</kbd> to search the library.
        <div style={{ marginTop: 8, fontSize: 11 }}>
          (Canvas, library, and inspector arrive in M2–M3.)
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<'editor' | 'perf'>('editor');

  const actions = (
    <>
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
      canvas={<CanvasPlaceholder />}
      status={
        <>
          <span>100%</span>
          <span>Saved</span>
          <span>No issues</span>
        </>
      }
    />
  );
}
