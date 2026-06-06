import { useRef, useEffect } from 'react';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import styles from './RichTextEditor.module.css';

/**
 * Small WYSIWYG editor for a component's rich-text description. contentEditable +
 * document.execCommand (deprecated but universal, zero dependencies). Every change is
 * sanitized before it leaves the editor, and the incoming value is sanitized before it's
 * shown — the stored HTML is untrusted (it round-trips through the .nexmap file).
 *
 * Toolbar: Bold / Italic / Underline / Strikethrough / bullet + numbered lists.
 */
const COMMANDS: { cmd: string; label: string; title: string; style?: React.CSSProperties }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold', style: { fontWeight: 700 } },
  { cmd: 'italic', label: 'I', title: 'Italic', style: { fontStyle: 'italic' } },
  { cmd: 'underline', label: 'U', title: 'Underline', style: { textDecoration: 'underline' } },
  { cmd: 'strikeThrough', label: 'S', title: 'Strikethrough', style: { textDecoration: 'line-through' } },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bullet list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
];

export function RichTextEditor({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (html: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync external value in (e.g. selecting a different device) without clobbering the
  // caret mid-type: only write innerHTML when the editor isn't the focused element.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeHtml(value);
    if (document.activeElement !== el && el.innerHTML !== clean) el.innerHTML = clean;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (el) onChange(sanitizeHtml(el.innerHTML));
  };

  const exec = (cmd: string) => {
    // execCommand acts on the current selection inside the focused editor.
    document.execCommand(cmd, false);
    ref.current?.focus();
    emit();
  };

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        {COMMANDS.map((c) => (
          <button
            key={c.cmd}
            type="button"
            title={c.title}
            aria-label={c.title}
            style={c.style}
            // preventDefault keeps the selection in the editor when the button is clicked
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(c.cmd)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className={styles.surface}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Component description"
        onInput={emit}
        onBlur={onCommit}
      />
    </div>
  );
}
