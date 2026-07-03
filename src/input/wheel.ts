/**
 * Wheel normalization + intent resolution for all three canvases (flat,
 * rack focus, rack row). Pure functions — no DOM access — so every branch is
 * provable from fixtures (docs/designs/pointer-native-canvas.md, M1).
 *
 *   raw WheelEvent ──▶ normalizeWheel ──▶ resolveWheel(pref) ──▶ pan | zoom
 *                        │                     │
 *                        │ deltaMode LINE×16   │ ctrl/pinch always zooms
 *                        │ PAGE×100            │ shift → horizontal pan
 *                        │ zoom clamp ≤120px   │ else the wheelAction pref
 *                        │ (pan UNclamped)     │ decides (pan is default)
 *
 * The device classifier is informational only (fixtures/diagnostics). It was
 * deliberately DEMOTED from mode-picking: Firefox reports discrete mouse
 * wheels as deltaMode=1 with |deltaY|≈3, which defeats magnitude heuristics.
 */

export type WheelAction = 'pan' | 'zoom';

/** Informational device class — never used to pick pan-vs-zoom. */
export type WheelClass = 'pinch' | 'trackpad' | 'wheel-notch';

/** The structural subset of WheelEvent we consume (keeps tests DOM-free). */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number; // 0 = pixel, 1 = line, 2 = page
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface NormalizedWheel {
  /** Pan-branch deltas in CSS px — normalized but UNclamped (free-spin stays fast). */
  dx: number;
  dy: number;
  /** Zoom-branch delta in CSS px — clamped to ±ZOOM_DELTA_CAP per event. */
  zoomDelta: number;
  /** ctrl/meta chord (browsers synthesize ctrlKey for trackpad pinch). */
  ctrl: boolean;
  shift: boolean;
  cls: WheelClass;
}

const LINE_PX = 16;
const PAGE_PX = 100;
/** One discrete mouse notch (~100–150 raw) caps here → ×~1.2 zoom per notch. */
export const ZOOM_DELTA_CAP = 120;
/** Zoom factor per normalized px; pow(1.0015, 120) ≈ 1.197. */
export const ZOOM_PER_PX = 1.0015;

function toPx(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * PAGE_PX;
  return delta;
}

function classify(e: WheelLike, dy: number): WheelClass {
  if (e.ctrlKey || e.metaKey) return 'pinch';
  // Fractional deltas or a horizontal component are trackpad signatures.
  if (!Number.isInteger(e.deltaY) || e.deltaX !== 0) return 'trackpad';
  // Line/page modes and large integer notches read as discrete wheels.
  if (e.deltaMode !== 0 || Math.abs(dy) >= 100) return 'wheel-notch';
  return 'trackpad';
}

export function normalizeWheel(e: WheelLike): NormalizedWheel {
  const dx = toPx(e.deltaX, e.deltaMode);
  const dy = toPx(e.deltaY, e.deltaMode);
  const zoomDelta = Math.max(-ZOOM_DELTA_CAP, Math.min(ZOOM_DELTA_CAP, dy));
  return {
    dx,
    dy,
    zoomDelta,
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    cls: classify(e, dy),
  };
}

export type WheelIntent =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

/**
 * Contract table (docs/designs/pointer-native-canvas.md — Wheel contract):
 *   ctrl/pinch        → zoom at cursor, both prefs
 *   shift + wheel     → horizontal pan, both prefs
 *   plain wheel       → the wheelAction pref decides ('pan' is the default)
 */
export function resolveWheel(n: NormalizedWheel, pref: WheelAction): WheelIntent {
  if (n.ctrl) return { kind: 'zoom', factor: Math.pow(ZOOM_PER_PX, -n.zoomDelta) };
  if (n.shift) {
    // Browsers with native shift-wheel support already swap into deltaX.
    const dx = n.dx !== 0 ? n.dx : n.dy;
    return { kind: 'pan', dx, dy: 0 };
  }
  if (pref === 'zoom') return { kind: 'zoom', factor: Math.pow(ZOOM_PER_PX, -n.zoomDelta) };
  return { kind: 'pan', dx: n.dx, dy: n.dy };
}

/**
 * Momentum-tail swallow: after an Escape-cancel or a modal opening, trackpad
 * inertia keeps emitting wheel events. Swallow same-direction events until a
 * sign change or QUIET_MS without any wheel event — whichever comes first.
 * Timestamps are passed in (e.timeStamp) so this stays deterministic in tests.
 */
export const MOMENTUM_QUIET_MS = 150;

export class MomentumGuard {
  private active = false;
  private lastDir = 0;
  private lastEventAt = 0;

  /** Arm the guard (call on gesture-cancel / modal-open). */
  block(now: number): void {
    this.active = true;
    this.lastDir = 0;
    this.lastEventAt = now;
  }

  /** True → the adapter drops this wheel event entirely. */
  shouldSwallow(dy: number, now: number): boolean {
    if (!this.active) return false;
    if (now - this.lastEventAt > MOMENTUM_QUIET_MS) {
      this.active = false;
      return false;
    }
    const dir = Math.sign(dy);
    if (this.lastDir !== 0 && dir !== 0 && dir !== this.lastDir) {
      this.active = false; // direction reversal = fresh user intent
      return false;
    }
    if (dir !== 0) this.lastDir = dir;
    this.lastEventAt = now;
    return true;
  }
}
