import { useEffect, useMemo, useRef, useState } from 'react';
import { NexIcon } from './icons/NexIcon';
import { firstSelectable, nextSelectable } from './commandPaletteNav';
import { rankCommands } from './commandPaletteSearch';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  /**
   * When true the command still shows (so it stays discoverable) but can't be
   * run — its `hint` carries the reason ("select 2+"). Keeps Conductor moves
   * that need a selection from firing into a no-op flash.
   */
  disabled?: boolean;
  /**
   * Section label for the empty-query view ("Build", "Address", …). Commands
   * cluster under their group so the palette reads as a menu, not a wall; while
   * the user is searching, groups fall away and the list is a flat ranked match.
   */
  group?: string;
}

/**
 * Section order for the grouped (empty-query) view. Groups not listed here, and
 * ungrouped commands, fall to the end in first-appearance order.
 */
const GROUP_ORDER = ['Suggested', 'Build', 'Connect', 'Address', 'Resilience', 'Repair', 'Rules', 'Edit', 'View', 'File'];

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

  // Ranked: literal matches (prefix, word-start, substring) beat loose ones.
  const filtered = useMemo(() => (q.trim() ? rankCommands(commands, q) : commands), [q, commands]);

  // For the empty query, re-order commands by group so the list reads as a menu,
  // and expose the section boundaries. `ordered` drives BOTH render and keyboard
  // nav, so the highlight always walks the list top-to-bottom as drawn. While the
  // user is searching, `ordered` is just `filtered` and there are no sections.
  const { ordered, sections } = useMemo(() => {
    if (q.trim()) return { ordered: filtered, sections: null };
    const byGroup = new Map<string, PaletteCommand[]>();
    for (const c of filtered) {
      const g = c.group ?? '';
      const arr = byGroup.get(g);
      if (arr) arr.push(c);
      else byGroup.set(g, [c]);
    }
    if (byGroup.size <= 1) return { ordered: filtered, sections: null }; // nothing to label
    const seen = [...byGroup.keys()];
    const rank = (g: string) => {
      const k = GROUP_ORDER.indexOf(g);
      return k === -1 ? GROUP_ORDER.length + seen.indexOf(g) : k;
    };
    const groups = [...seen].sort((a, b) => rank(a) - rank(b));
    const ord: PaletteCommand[] = [];
    const secs: { group: string; items: { c: PaletteCommand; i: number }[] }[] = [];
    for (const g of groups) {
      const items = byGroup.get(g)!.map((c) => {
        const i = ord.length;
        ord.push(c);
        return { c, i };
      });
      secs.push({ group: g, items });
    }
    return { ordered: ord, sections: secs };
  }, [q, filtered]);

  useEffect(() => setActive(firstSelectable(ordered)), [ordered]);

  function run(c?: PaletteCommand) {
    if (!c || c.disabled) return;
    onClose();
    c.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => nextSelectable(ordered, a, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => nextSelectable(ordered, a, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(ordered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  /** One command row. `i` is its index into `filtered` (the nav/active space). */
  function renderRow(c: PaletteCommand, i: number) {
    return (
      <li
        key={c.id}
        role="option"
        aria-selected={i === active}
        aria-disabled={c.disabled || undefined}
        onMouseEnter={() => {
          if (!c.disabled) setActive(i);
        }}
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
          cursor: c.disabled ? 'default' : 'pointer',
          background: i === active ? 'var(--accent-soft)' : 'transparent',
          color: 'var(--chrome-fg)',
          opacity: c.disabled ? 0.45 : 1,
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
    );
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
          {ordered.length === 0 && (
            <li style={{ padding: '16px 12px', color: 'var(--chrome-fg-subtle)', fontSize: 13, textAlign: 'center' }}>
              No matching command.
            </li>
          )}
          {sections
            ? sections.map((sec) => (
                <li key={`sec-${sec.group}`} style={{ listStyle: 'none' }}>
                  <div
                    role="presentation"
                    style={{
                      padding: '10px 12px 4px',
                      fontFamily: 'var(--font-mono-pre)',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--chrome-fg-subtle)',
                    }}
                  >
                    {sec.group}
                  </div>
                  <ul role="group" aria-label={sec.group} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {sec.items.map(({ c, i }) => renderRow(c, i))}
                  </ul>
                </li>
              ))
            : ordered.map((c, i) => renderRow(c, i))}
        </ul>
      </div>
    </div>
  );
}
