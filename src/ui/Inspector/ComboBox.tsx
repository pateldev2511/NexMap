import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ComboBox.module.css';

/**
 * Combo-box: a free-text input with a preset suggestion list (Vendor / Model /
 * Role). Replaces the native <datalist>, whose popup the browser positions
 * itself — and mispositions in this layout. We render the menu ourselves with
 * `position: fixed` anchored to the input's rect, so it always sits directly
 * under the field and is never clipped by the inspector's scroll container.
 *
 * Behavior: type anything (custom values allowed); presets filter as you type;
 * Arrow/Enter/Escape navigate; click or Enter commits; blur or outside-click
 * closes and commits.
 */

interface ComboBoxProps {
  value: string;
  options: readonly string[];
  placeholder?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}

export function ComboBox({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
  onCommit,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = value.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : [...options];

  const reposition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 2, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        onCommit();
      }
    };
    const onScrollOrResize = () => reposition();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, reposition, onCommit]);

  function choose(opt: string) {
    onChange(opt);
    onCommit();
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setActive((a) => Math.min(a + 1, matches.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && matches[active]) {
        e.preventDefault();
        choose(matches[active]!);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={styles.combo} ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          if (!open) setOpen(true);
          reposition();
        }}
        onFocus={() => {
          setOpen(true);
          reposition();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Choosing an option uses mousedown+preventDefault, so focus never
          // leaves and this won't fire mid-pick. Any other blur (tab away,
          // click elsewhere) should both commit and close the menu.
          setOpen(false);
          onCommit();
        }}
      />
      {open && pos && matches.length > 0 && (
        <ul
          className={styles.menu}
          style={{ left: pos.left, top: pos.top, width: pos.width }}
          role="listbox"
        >
          {matches.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={i === active}
              className={`${styles.option} ${i === active ? styles.active : ''}`}
              onMouseEnter={() => setActive(i)}
              // mousedown (not click) so we beat the input's blur; preventDefault
              // keeps focus from leaving before we commit the choice.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(opt);
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
