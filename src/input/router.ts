/**
 * The ONE window keydown/keyup owner (docs/designs/pointer-native-canvas.md,
 * Adapter & router contract). Routing order:
 *
 *   text field?  ──▶ router steps aside entirely (native editing wins)
 *        │
 *   OVERLAYS (LIFO: context menu, palette, dialogs, presentation Esc)
 *        │
 *   GESTURE-CANCEL (Escape / undo-redo combos while a gesture is in flight —
 *        │           the keypress is CONSUMED: cancel only, history untouched)
 *        │
 *   CANVAS shortcuts (the registered canvas's handleKey)
 *        │
 *   APP shortcuts (Cmd+S / Cmd+Z / palette / …)
 *
 * Fault isolation with ABORTED CONTINUATIONS: every handler runs inside
 * try/catch; a throw is dev-warned and treated as "not handled" — EXCEPT the
 * undo path, where a throwing cancelActiveGesture ABORTS the undo (applying
 * undo over a live drag is the stale-dragOrigins corruption this plan kills).
 *
 * Registration is StrictMode-idempotent (Map set/delete; mount→unmount→mount
 * is symmetric). Unregistering while a gesture is active cancels it first.
 */

export interface CanvasKeyApi {
  cancelActiveGesture: () => void;
  hasActiveGesture: () => boolean;
  /** Canvas-shortcut stage (arrow nudge, Delete, mode keys). True = handled. */
  handleKey: (e: KeyboardEvent) => boolean;
  /** Space/Alt release tracking. */
  handleKeyUp: (e: KeyboardEvent) => void;
}

export type OverlayHandler = (e: KeyboardEvent) => boolean;
export type AppHandler = (e: KeyboardEvent) => boolean;

export function isTextTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' || // the audit's missing case — dropdowns eat keys too
    !!t.isContentEditable
  );
}

export function isUndoRedoCombo(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
}

const warn = (where: string, err: unknown) => {
  if (import.meta.env?.DEV) console.warn(`[input:router] ${where} handler threw`, err);
};

export class KeyboardRouter {
  private canvases = new Map<string, CanvasKeyApi>();
  private activeId: string | null = null;
  private overlays: OverlayHandler[] = [];
  private appHandlers: AppHandler[] = [];
  private detach: (() => void) | null = null;

  /** Idempotent (StrictMode-safe): same id re-registers in place. */
  registerCanvas(id: string, api: CanvasKeyApi): () => void {
    this.canvases.set(id, api);
    this.activeId = id; // one canvas mounts at a time (App mode is exclusive)
    return () => this.unregisterCanvas(id, api);
  }

  private unregisterCanvas(id: string, api: CanvasKeyApi): void {
    // Unmount-during-active-gesture: cancel + release BEFORE dropping the ref.
    if (this.canvases.get(id) === api) {
      try {
        if (api.hasActiveGesture()) api.cancelActiveGesture();
      } catch (err) {
        warn('unregister-cancel', err);
      }
      this.canvases.delete(id);
      if (this.activeId === id) {
        this.activeId = this.canvases.size ? [...this.canvases.keys()].pop()! : null;
      }
    }
  }

  /** LIFO overlay stack — the innermost thing Escape can close. */
  registerOverlay(h: OverlayHandler): () => void {
    this.overlays.push(h);
    return () => {
      const i = this.overlays.lastIndexOf(h);
      if (i >= 0) this.overlays.splice(i, 1);
    };
  }

  registerApp(h: AppHandler): () => void {
    this.appHandlers.push(h);
    return () => {
      const i = this.appHandlers.lastIndexOf(h);
      if (i >= 0) this.appHandlers.splice(i, 1);
    };
  }

  private active(): CanvasKeyApi | null {
    return this.activeId ? this.canvases.get(this.activeId) ?? null : null;
  }

  /** Exposed for tests; install() wires it to a real window. */
  handleKeyDown = (e: KeyboardEvent): void => {
    // 1) Text fields manage themselves — Cmd+Z must be TEXT undo there.
    if (isTextTarget(e.target)) return;

    // 2) Overlays, innermost first. A throw = not handled, next layer runs.
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const overlay = this.overlays[i];
      if (!overlay) continue;
      try {
        if (overlay(e)) return;
      } catch (err) {
        warn('overlay', err);
      }
    }

    const canvas = this.active();

    // 3) Gesture-cancel stage.
    if (canvas) {
      let inFlight = false;
      try {
        inFlight = canvas.hasActiveGesture();
      } catch (err) {
        warn('hasActiveGesture', err);
      }
      if (inFlight && (e.key === 'Escape' || isUndoRedoCombo(e))) {
        e.preventDefault();
        try {
          canvas.cancelActiveGesture();
        } catch (err) {
          warn('cancelActiveGesture', err);
        }
        // CONSUMED either way. For undo: cancel-throw aborts the undo, and a
        // clean cancel also does NOT pop history (second press undoes).
        return;
      }
    }

    // 4) Canvas shortcuts.
    if (canvas) {
      try {
        if (canvas.handleKey(e)) return;
      } catch (err) {
        warn('canvas', err);
      }
    }

    // 5) App shortcuts.
    for (const h of this.appHandlers) {
      try {
        if (h(e)) return;
      } catch (err) {
        warn('app', err);
      }
    }
  };

  handleKeyUp = (e: KeyboardEvent): void => {
    const canvas = this.active();
    if (!canvas) return;
    try {
      canvas.handleKeyUp(e);
    } catch (err) {
      warn('keyup', err);
    }
  };

  /** Attach the single window listener pair. Idempotent. */
  install(win: Window = window): () => void {
    if (this.detach) return this.detach;
    const down = this.handleKeyDown as unknown as EventListener;
    const up = this.handleKeyUp as unknown as EventListener;
    win.addEventListener('keydown', down);
    win.addEventListener('keyup', up);
    this.detach = () => {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
      this.detach = null;
    };
    return this.detach;
  }
}

/** App-wide singleton; canvases and App.tsx register against this. */
export const keyboardRouter = new KeyboardRouter();
