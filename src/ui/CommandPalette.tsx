import { useEffect, useMemo, useRef, useState } from 'react';
import { NexIcon } from './icons/NexIcon';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Subsequence fuzzy match: every char of `q` appears in order within `text`. */
function fuzzy(text: string, q: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

/**
 * Command palette (Cmd/Ctrl+K) — fuzzy access to every app action without
 * hunting the toolbar. Pure presentational: App assembles the command list.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter(
      (c) => fuzzy(c.label.toLowerCase(), s) || c.hint?.toLowerCase().includes(s),
    );
  }, [q, commands]);

  useEffect(() => setActive(0), [q]);

  function run(c?: PaletteCommand) {
    if (!c) return;
    onClose();
    c.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'color-mix(in srgb, var(--deck-bg, #05080e) 42%, transparent)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '13vh',
        animation: 'nx-fade var(--dur-2) var(--ease-out) both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
        style={{
          width: 'min(580px, 92vw)',
          fontFamily: 'var(--font-ui-pre)',
          background: 'color-mix(in srgb, var(--chrome-bg) 94%, transparent)',
          border: '1px solid var(--chrome-border-strong)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-float)',
          overflow: 'hidden',
          animation: 'nx-pop var(--dur-3) var(--ease-spring) both',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--chrome-border)',
          }}
        >
          <NexIcon name="search" style={{ width: 18, height: 18, color: 'var(--accent)', flex: 'none' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            aria-label="Command"
            style={{
              flex: 1,
              boxSizing: 'border-box',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--chrome-fg)',
              fontSize: 15,
              outline: 'none',
            }}
          />
          <kbd
            style={{
              fontFamily: 'var(--font-mono-pre)',
              fontSize: 10.5,
              fontWeight: 600,
              padding: '3px 7px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--chrome-border)',
              background: 'var(--chrome-bg-2)',
              color: 'var(--chrome-fg-muted)',
            }}
          >
            ESC
          </kbd>
        </div>
        <ul
          role="listbox"
          style={{ listStyle: 'none', margin: 0, padding: 6, maxHeight: 376, overflowY: 'auto' }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '16px 12px', color: 'var(--chrome-fg-subtle)', fontSize: 13, textAlign: 'center' }}>
              No matching command.
            </li>
          )}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(c);
              }}
              style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px 10px 16px',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                background: i === active ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--chrome-fg)',
                fontSize: 13.5,
                fontWeight: 500,
                transition: 'background var(--dur-1)',
              }}
            >
              {i === active && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 5,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 3,
                    height: 16,
                    borderRadius: 2,
                    background: 'var(--accent)',
                  }}
                />
              )}
              <span>{c.label}</span>
              {c.hint && (
                <kbd
                  style={{
                    fontFamily: 'var(--font-mono-pre)',
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--chrome-border)',
                    background: 'var(--chrome-bg-2)',
                    color: 'var(--chrome-fg-muted)',
                  }}
                >
                  {c.hint}
                </kbd>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
