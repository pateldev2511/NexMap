import { useEffect, useMemo, useRef, useState } from 'react';

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
        background: 'rgba(2,6,23,0.32)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
        style={{
          width: 'min(560px, 92vw)',
          background: 'var(--chrome-bg)',
          border: '1px solid var(--chrome-border)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          aria-label="Command"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '14px 16px',
            border: 'none',
            borderBottom: '1px solid var(--chrome-border)',
            background: 'transparent',
            color: 'var(--chrome-fg)',
            fontSize: 15,
            outline: 'none',
          }}
        />
        <ul
          role="listbox"
          style={{ listStyle: 'none', margin: 0, padding: 6, maxHeight: 360, overflowY: 'auto' }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '10px 12px', color: 'var(--chrome-fg-muted)', fontSize: 13 }}>
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '9px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                background:
                  i === active ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
                color: 'var(--chrome-fg)',
                fontSize: 13,
              }}
            >
              <span>{c.label}</span>
              {c.hint && (
                <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--chrome-fg-muted)' }}>
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
