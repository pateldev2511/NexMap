import { useEffect, useMemo, useRef, useState } from 'react';
import { NexIcon } from './icons/NexIcon';
import { NexMapLogo } from './deck/NexMapLogo';
import { DeckBackground } from './deck/DeckBackground';
import { NetworkArt, RackArt } from './deck/deckArt';
import { VideoReel } from './deck/VideoReel';
import styles from './DesignerChooser.module.css';

export type DesignerMode = 'network' | 'rack';

const APP_VERSION = '0.6.2'; // keep in step with package.json

type LaunchAction = {
  id: string;
  label: string;
  hint: string;
  icon: Parameters<typeof NexIcon>[0]['name'];
  run: () => void;
};

/**
 * The NexMap Deck — the local-first entry hub. A command-first, spatial launcher:
 * a live 3D network constellation behind bespoke mode-tiles, with a universal
 * quick-launch (the same muscle as ⌘K in the editor). The two designers edit the
 * same .nexmap document — this just routes which editor you drop into.
 *
 * Contract preserved for e2e: role="dialog" aria-label="Choose a designer", and two
 * buttons whose accessible names contain "Network Designer" / "Rack Designer", plus
 * the "Open a .nexmap file" affordance.
 */
export function DesignerChooser({
  onPick,
  onOpen,
  theme,
  onToggleTheme,
}: {
  onPick: (mode: DesignerMode) => void;
  onOpen?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}) {
  const [launchOpen, setLaunchOpen] = useState(false);
  const [reelOpen, setReelOpen] = useState(false);

  const actions = useMemo<LaunchAction[]>(() => {
    const list: LaunchAction[] = [
      {
        id: 'network',
        label: 'Network Designer',
        hint: 'Draw & validate topologies',
        icon: 'connect',
        run: () => onPick('network'),
      },
      {
        id: 'rack',
        label: 'Rack Designer',
        hint: 'Build rack elevations',
        icon: 'rack',
        run: () => onPick('rack'),
      },
    ];
    if (onOpen)
      list.push({
        id: 'open',
        label: 'Open a .nexmap file',
        hint: 'Resume a saved project',
        icon: 'open-file',
        run: () => onOpen(),
      });
    if (onToggleTheme)
      list.push({
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Appearance',
        icon: 'theme',
        run: () => onToggleTheme(),
      });
    return list;
  }, [onPick, onOpen, onToggleTheme, theme]);

  // ⌘K / Ctrl+K opens the quick-launch from the Deck too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLaunchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.root} role="dialog" aria-label="Choose a designer">
      <DeckBackground className={styles.bg} />
      <div className={styles.gridOverlay} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />

      <div className={styles.stage}>
        <header className={styles.topline} style={{ animationDelay: '40ms' }}>
          <NexMapLogo size={34} />
          <div className={styles.toplineRight}>
            <span className={styles.chip}>
              <span className={styles.dot} /> 100% LOCAL
            </span>
            <span className={styles.chipMono}>v{APP_VERSION}</span>
            {onToggleTheme && (
              <button
                className={styles.iconBtn}
                onClick={onToggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title="Toggle theme"
              >
                <NexIcon name="theme" />
              </button>
            )}
          </div>
        </header>

        <div className={styles.hero}>
          <div className={styles.eyebrow} style={{ animationDelay: '120ms' }}>
            NETWORK &amp; RACK DESIGN STUDIO
          </div>
          <h1 className={styles.headline} style={{ animationDelay: '180ms' }}>
            Design infrastructure that
            <br />
            <span className={styles.grad}>validates itself.</span>
          </h1>
          <p className={styles.sub} style={{ animationDelay: '260ms' }}>
            A local-first studio for network topologies and rack elevations. No login,
            no cloud — every byte stays on your machine.
          </p>

          <button
            className={styles.commandBar}
            style={{ animationDelay: '320ms' }}
            onClick={() => setLaunchOpen(true)}
            aria-haspopup="dialog"
          >
            <NexIcon name="search" />
            <span className={styles.commandBarText}>
              Jump in — search designers, files &amp; actions
            </span>
            <kbd className={styles.kbd}>⌘K</kbd>
          </button>

          <button
            className={styles.reelLink}
            style={{ animationDelay: '360ms' }}
            onClick={() => setReelOpen(true)}
          >
            <span className={styles.reelDot} aria-hidden="true" />
            See NexMap in motion
          </button>
        </div>

        <div className={styles.tiles}>
          <button
            className={`${styles.tile} ${styles.tileNet}`}
            onClick={() => onPick('network')}
            style={{ animationDelay: '380ms' }}
            autoFocus
          >
            <div className={styles.tileGlow} aria-hidden="true" />
            <div className={styles.tileArt}>
              <NetworkArt className={styles.artSvg} />
            </div>
            <div className={styles.tileBody}>
              <div className={styles.tileKicker}>
                <span className={`${styles.tileIcon} ${styles.net}`}>
                  <NexIcon name="connect" />
                </span>
                <span className={styles.tileTag}>TOPOLOGY</span>
              </div>
              <h3 className={styles.tileTitle}>Network Designer</h3>
              <p className={styles.tileDesc}>
                Routers, switches, firewalls &amp; cloud. Connect devices, label links,
                validate live, and flip to isometric 3D.
              </p>
              <span className={styles.tileGo}>
                Start designing a network <NexIcon name="arrow-up" />
              </span>
            </div>
          </button>

          <button
            className={`${styles.tile} ${styles.tileRack}`}
            onClick={() => onPick('rack')}
            style={{ animationDelay: '440ms' }}
          >
            <div className={styles.tileGlow} aria-hidden="true" />
            <div className={styles.tileArt}>
              <RackArt className={styles.artSvg} />
            </div>
            <div className={styles.tileBody}>
              <div className={styles.tileKicker}>
                <span className={`${styles.tileIcon} ${styles.rack}`}>
                  <NexIcon name="rack" />
                </span>
                <span className={styles.tileTag}>ELEVATION</span>
              </div>
              <h3 className={styles.tileTitle}>Rack Designer</h3>
              <p className={styles.tileDesc}>
                Mount switches, servers, patch panels &amp; PDUs at any U, cable
                port-to-port, and export a cable schedule.
              </p>
              <span className={styles.tileGo}>
                Start designing a rack <NexIcon name="arrow-up" />
              </span>
            </div>
          </button>
        </div>

        <footer className={styles.foot} style={{ animationDelay: '520ms' }}>
          {onOpen ? (
            <button className={styles.footOpen} onClick={onOpen}>
              <NexIcon name="open-file" />
              Open a .nexmap file
            </button>
          ) : (
            <span />
          )}
          <span className={styles.footNote}>
            <NexIcon name="save" /> Your data never leaves this device
          </span>
        </footer>
      </div>

      {launchOpen && (
        <DeckLauncher actions={actions} onClose={() => setLaunchOpen(false)} />
      )}

      {reelOpen && <ReelLightbox onClose={() => setReelOpen(false)} />}
    </div>
  );
}

/** Lightbox playing the bundled motion reel. Esc / backdrop / button closes. */
function ReelLightbox({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.reelScrim} role="dialog" aria-label="NexMap motion reel" onClick={onClose}>
      <div className={styles.reelStage} onClick={(e) => e.stopPropagation()}>
        <VideoReel />
        <button className={styles.reelClose} onClick={onClose} aria-label="Close reel">
          <NexIcon name="close" />
        </button>
      </div>
    </div>
  );
}

/** Command-first quick-launch for the Deck — fuzzy filter, arrow-key nav, Enter to run. */
function DeckLauncher({
  actions,
  onClose,
}: {
  actions: LaunchAction[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((a) => {
      const hay = (a.label + ' ' + a.hint).toLowerCase();
      let i = 0;
      for (const ch of needle) {
        i = hay.indexOf(ch, i);
        if (i === -1) return false;
        i++;
      }
      return true;
    });
  }, [q, actions]);

  useEffect(() => {
    if (sel >= filtered.length) setSel(Math.max(0, filtered.length - 1));
  }, [filtered, sel]);

  function run(a: LaunchAction | undefined) {
    if (!a) return;
    onClose();
    a.run();
  }

  return (
    <div
      className={styles.launchScrim}
      role="dialog"
      aria-label="Quick launch"
      onClick={onClose}
    >
      <div
        className={styles.launchPanel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(filtered.length - 1, s + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(filtered[sel]);
          }
        }}
      >
        <div className={styles.launchInputRow}>
          <NexIcon name="search" />
          <input
            ref={inputRef}
            className={styles.launchInput}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Where to?  Try “network”, “rack”, “open”…"
            aria-label="Quick launch search"
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>
        <ul className={styles.launchList} role="listbox" aria-label="Destinations">
          {filtered.length === 0 && <li className={styles.launchEmpty}>Nothing matches.</li>}
          {filtered.map((a, i) => (
            <li key={a.id}>
              <button
                className={`${styles.launchItem} ${i === sel ? styles.launchItemActive : ''}`}
                onClick={() => run(a)}
                onMouseEnter={() => setSel(i)}
                role="option"
                aria-selected={i === sel}
              >
                <span className={styles.launchItemIcon}>
                  <NexIcon name={a.icon} />
                </span>
                <span className={styles.launchItemLabel}>{a.label}</span>
                <span className={styles.launchItemHint}>{a.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
