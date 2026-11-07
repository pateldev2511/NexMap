import { useEffect, useId, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';
import { keyboardRouter } from '@/input/router';

/**
 * The modal-dialog contract every file/settings overlay shares:
 *
 *  - a named modal: role="dialog", aria-modal, aria-labelledby → the dialog's heading
 *  - focus moves inside on open (kept where it is if something inside already took
 *    it, e.g. an autoFocus field) and goes back to whatever had it on close
 *  - Tab / Shift+Tab cycle within the dialog, and focus that lands outside is pulled back
 *  - Escape closes the TOPMOST dialog only
 *  - while open, no key reaches the editor's canvas or app shortcuts, and a paste
 *    inside the dialog never reaches the canvas paste-import
 *
 * Escape and Tab are handled on the dialog element itself, because the keyboard
 * router steps aside for text fields; a router overlay covers everything else (and
 * Escape when focus is somewhere unexpected). Omit `onClose` for a dialog that must
 * be answered (Escape then does nothing).
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OpenModal {
  token: symbol;
  root: HTMLElement | null;
  close: () => void;
}
/** Open modals, bottom first — the last one owns the keyboard. */
const stack: OpenModal[] = [];
const isTop = (token: symbol) => stack[stack.length - 1]?.token === token;

/**
 * Child effects run before their parent's, so a dialog nested in another one can
 * register first; it still belongs above its parent.
 */
function pushModal(entry: OpenModal): void {
  const child = stack.findIndex((m) => !!m.root && !!entry.root?.contains(m.root));
  if (child >= 0) stack.splice(child, 0, entry);
  else stack.push(entry);
}

/**
 * Chords the app owns (Save, Open, Print). The overlay keeps them from the app while
 * a dialog is open; without this they would fall through to the browser's own Save
 * Page / Open File / Print instead of doing nothing.
 */
function blockBrowserChord(e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault(): void }) {
  if ((e.metaKey || e.ctrlKey) && ['s', 'o', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert], [hidden]') && (el.checkVisibility?.() ?? true),
  );
}

export function useModalDialog(onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const token = useRef(Symbol('modal')).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    pushModal({ token, root, close: () => closeRef.current?.() });
    if (root && !root.contains(document.activeElement)) root.focus();

    // Swallow every key the router would hand to the canvas or app shortcuts.
    // Whichever modal's overlay the router asks first, Escape goes to the top one.
    const offKeys = keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stack[stack.length - 1]?.close();
      }
      blockBrowserChord(e);
      return true;
    });
    // Focus that escapes (a click on the page behind, a programmatic focus) comes back.
    const onFocusIn = (e: FocusEvent) => {
      if (!isTop(token) || !root || root.contains(e.target as Node)) return;
      root.focus();
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      offKeys();
      document.removeEventListener('focusin', onFocusIn);
      const i = stack.findIndex((m) => m.token === token);
      if (i >= 0) stack.splice(i, 1);
      // Only hand focus back if it was ours to give — not if the user moved on.
      const active = document.activeElement;
      const ours = !active || active === document.body || !!root?.contains(active);
      if (ours && opener?.isConnected) opener.focus();
    };
  }, [token]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!isTop(token)) return;
    // Text fields bypass the router overlay, so cover them here too.
    blockBrowserChord(e);
    if (e.key === 'Escape') {
      // Ours alone: the router (and the canvas behind it) never sees it.
      e.stopPropagation();
      if (closeRef.current) {
        e.preventDefault();
        closeRef.current();
      }
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      ref.current.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    const inside = items.includes(active as HTMLElement);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  // A paste inside the dialog is for its fields (native paste still happens), never
  // the canvas's clipboard import listening on window.
  const stopPaste = (e: SyntheticEvent) => e.stopPropagation();

  return {
    titleId,
    dialogProps: {
      ref,
      role: 'dialog' as const,
      'aria-modal': true as const,
      'aria-labelledby': titleId,
      tabIndex: -1,
      onKeyDown,
      onPaste: stopPaste,
    },
  };
}
