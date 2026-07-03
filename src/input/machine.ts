/**
 * The shared gesture LIFECYCLE SKELETON for all three canvases (flat,
 * rack focus editor, rack row). Pure reducer — zero DOM access — so every
 * transition is provable by feeding event sequences (see machine.test.ts and
 * fuzz.test.ts). Canvases contribute their own gesture KINDS by arming the
 * machine from their pointerdown hit-testing; the skeleton owns the
 * invariants that shipped broken twice: capture lifecycle, cancellation,
 * thresholds, buttons validation, and second-pointer policy.
 *
 *                 arm(gesture)             dist >= 4 CSS px
 *   idle ──────────────────────▶ armed ─────────────────────▶ active
 *    ▲                            │                             │
 *    │            up below        │ up                          │ up
 *    │            threshold =     ▼                             ▼
 *    │            CLICK        [click effect]               [commit effect]
 *    │                            │                             │
 *    ◀────────────────────────────┴──────────────┬──────────────┘
 *    │                                           │
 *    │   pointercancel / lostcapture / Escape /  │
 *    │   blur / buttons==0 on move  ──▶ [cancel effect] ──▶ idle  (ALWAYS)
 *    │
 *    │   2nd pointer, touch:  cancel current ──▶ PINCH (pan+zoom)
 *    │   2nd pointer, mouse/pen: ignored (captured gesture keeps ownership)
 *    │   pinch, one finger up: remaining finger continues as single-touch PAN
 *    │
 *    └── swallowNextClick is a machine STATE that expires on the next
 *        press or native click — never a mutable boolean ref.
 *
 * Effects are commands for the adapter to run synchronously inside the
 * originating DOM handler (capture/release/preventDefault) or to route into
 * the store (begin/update/commit/cancel/click). The reducer is TOTAL: any
 * event in any state returns a defined result; unknown combos are no-ops.
 */

export type PointerKind = 'mouse' | 'pen' | 'touch';

/** Click-vs-drag threshold in CSS px — identical feel at every zoom level. */
export const CLICK_DRAG_THRESHOLD_PX = 4;

export interface MachineEvent {
  type:
    | 'arm' // adapter hit-tested a pointerdown and chose a gesture kind
    | 'down' // a pointerdown the adapter did NOT arm (e.g. second pointer)
    | 'move'
    | 'up'
    | 'cancel' // pointercancel
    | 'lostcapture'
    | 'escape'
    | 'blur'
    | 'nativeclick'; // trailing browser click after a gesture
  pointerId?: number;
  pointerType?: PointerKind;
  /** For 'arm'/'down'. */
  button?: number;
  /** Current buttons bitmask on moves — 0 means we missed the release. */
  buttons?: number;
  x?: number;
  y?: number;
  /** 'arm' only. */
  gesture?: string;
  data?: unknown;
  /** 'arm' only: skip the threshold (pan-style gestures start immediately). */
  immediate?: boolean;
  /** 'arm' only: swallow the trailing native click after this commits. */
  swallowTrailingClick?: boolean;
}

export interface Pt {
  id: number;
  x: number;
  y: number;
}

export interface MachineState {
  phase: 'idle' | 'armed' | 'active' | 'pinch';
  gesture: string | null;
  data: unknown;
  pointerId: number | null;
  pointerType: PointerKind | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  swallowTrailingClick: boolean;
  /** Set after a commit that requested it; expires on next press/click. */
  swallowNextClick: boolean;
  /** Both fingers during a pinch. */
  pinch: { a: Pt; b: Pt } | null;
}

export const IDLE: MachineState = {
  phase: 'idle',
  gesture: null,
  data: null,
  pointerId: null,
  pointerType: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  swallowTrailingClick: false,
  swallowNextClick: false,
  pinch: null,
};

export type Effect =
  | { kind: 'capture'; pointerId: number }
  | { kind: 'release'; pointerId: number }
  | { kind: 'begin'; gesture: string; data: unknown; x: number; y: number }
  | {
      kind: 'update';
      gesture: string;
      data: unknown;
      x: number;
      y: number;
      dx: number;
      dy: number;
      startX: number;
      startY: number;
      alt: boolean;
      shift: boolean;
    }
  | { kind: 'commit'; gesture: string; data: unknown; x: number; y: number }
  | { kind: 'cancel'; gesture: string; data: unknown }
  | { kind: 'click'; gesture: string; data: unknown; x: number; y: number; shift: boolean }
  | { kind: 'swallowClick' }
  | { kind: 'pinchStart'; a: Pt; b: Pt }
  | { kind: 'pinchUpdate'; a: Pt; b: Pt; prevA: Pt; prevB: Pt }
  | { kind: 'pinchEnd' };

export interface ReduceResult {
  state: MachineState;
  effects: Effect[];
}

interface Mods {
  alt?: boolean;
  shift?: boolean;
}

const no = (state: MachineState): ReduceResult => ({ state, effects: [] });

function toIdleCancel(state: MachineState): ReduceResult {
  const effects: Effect[] = [];
  if (state.phase === 'active' && state.gesture) {
    effects.push({ kind: 'cancel', gesture: state.gesture, data: state.data });
  }
  if (state.phase === 'pinch') {
    effects.push({ kind: 'pinchEnd' });
    // Release BOTH fingers — a cancelled pinch must not dangle captures.
    if (state.pinch) {
      effects.push({ kind: 'release', pointerId: state.pinch.a.id });
      effects.push({ kind: 'release', pointerId: state.pinch.b.id });
    }
  }
  if (state.pointerId != null) effects.push({ kind: 'release', pointerId: state.pointerId });
  return { state: { ...IDLE }, effects };
}

export function reduce(
  state: MachineState,
  e: MachineEvent,
  mods: Mods = {},
): ReduceResult {
  switch (e.type) {
    case 'arm': {
      // Arming while something is in flight is a programming error in the
      // adapter; the machine defends by cancelling the old gesture first
      // (single gesture slot — two active gestures are unrepresentable).
      const pre = state.phase === 'idle' ? no(state) : toIdleCancel(state);
      const s: MachineState = {
        ...IDLE,
        phase: e.immediate ? 'active' : 'armed',
        gesture: e.gesture ?? null,
        data: e.data ?? null,
        pointerId: e.pointerId ?? null,
        pointerType: e.pointerType ?? 'mouse',
        startX: e.x ?? 0,
        startY: e.y ?? 0,
        lastX: e.x ?? 0,
        lastY: e.y ?? 0,
        swallowTrailingClick: !!e.swallowTrailingClick,
      };
      const effects: Effect[] = [...pre.effects];
      if (e.pointerId != null) effects.push({ kind: 'capture', pointerId: e.pointerId });
      if (e.immediate && s.gesture) {
        effects.push({ kind: 'begin', gesture: s.gesture, data: s.data, x: s.startX, y: s.startY });
      }
      return { state: s, effects };
    }

    case 'down': {
      // A pointerdown the adapter didn't arm. Second-pointer policy:
      if (state.phase === 'armed' || state.phase === 'active') {
        if (e.pointerType === 'touch' && state.pointerType === 'touch') {
          // Touch escape hatch: cancel the gesture, enter pinch.
          const cancelled = toIdleCancel(state);
          const a: Pt = { id: state.pointerId ?? -1, x: state.lastX, y: state.lastY };
          const b: Pt = { id: e.pointerId ?? -2, x: e.x ?? 0, y: e.y ?? 0 };
          return {
            state: { ...IDLE, phase: 'pinch', pointerType: 'touch', pinch: { a, b } },
            effects: [
              ...cancelled.effects.filter((f) => f.kind !== 'release'), // keep first pointer captured
              ...(e.pointerId != null ? [{ kind: 'capture', pointerId: e.pointerId } as Effect] : []),
              { kind: 'pinchStart', a, b },
            ],
          };
        }
        return no(state); // mouse/pen second button: captured gesture keeps ownership
      }
      if (state.phase === 'idle' && e.pointerType === 'touch' && state.pinch === null) {
        // First touch with nothing armed: the adapter arms gestures itself,
        // so an unarmed touch down is just remembered implicitly by the DOM;
        // nothing for the machine to do.
        return no({ ...state, swallowNextClick: false });
      }
      if (state.phase === 'pinch') return no(state); // 3rd finger: ignored
      return no({ ...state, swallowNextClick: false });
    }

    case 'move': {
      if (state.phase === 'armed' || state.phase === 'active') {
        if (e.pointerId != null && state.pointerId != null && e.pointerId !== state.pointerId) {
          return no(state); // stray pointer
        }
        // Ghost-gesture kill: a buttonless move means we missed the release.
        if (
          state.pointerType !== 'touch' &&
          e.buttons !== undefined &&
          e.buttons === 0
        ) {
          return toIdleCancel(state);
        }
        const x = e.x ?? state.lastX;
        const y = e.y ?? state.lastY;
        if (state.phase === 'armed') {
          const dist = Math.hypot(x - state.startX, y - state.startY);
          if (dist < CLICK_DRAG_THRESHOLD_PX) return no({ ...state, lastX: x, lastY: y });
          const s = { ...state, phase: 'active' as const, lastX: x, lastY: y };
          return {
            state: s,
            effects: [
              { kind: 'begin', gesture: s.gesture!, data: s.data, x: s.startX, y: s.startY },
              {
                kind: 'update',
                gesture: s.gesture!,
                data: s.data,
                x,
                y,
                dx: x - s.startX,
                dy: y - s.startY,
                startX: s.startX,
                startY: s.startY,
                alt: !!mods.alt,
                shift: !!mods.shift,
              },
            ],
          };
        }
        const s = { ...state, lastX: x, lastY: y };
        return {
          state: s,
          effects: [
            {
              kind: 'update',
              gesture: s.gesture!,
              data: s.data,
              x,
              y,
              dx: x - s.startX,
              dy: y - s.startY,
              startX: s.startX,
              startY: s.startY,
              alt: !!mods.alt,
              shift: !!mods.shift,
            },
          ],
        };
      }
      if (state.phase === 'pinch' && state.pinch) {
        const { a, b } = state.pinch;
        if (e.pointerId === a.id || e.pointerId === b.id) {
          const na = e.pointerId === a.id ? { ...a, x: e.x ?? a.x, y: e.y ?? a.y } : a;
          const nb = e.pointerId === b.id ? { ...b, x: e.x ?? b.x, y: e.y ?? b.y } : b;
          return {
            state: { ...state, pinch: { a: na, b: nb } },
            effects: [{ kind: 'pinchUpdate', a: na, b: nb, prevA: a, prevB: b }],
          };
        }
        return no(state);
      }
      return no(state);
    }

    case 'up': {
      if (state.phase === 'armed') {
        // Below threshold: this was a click. Selection rules live in the
        // adapter's click handler for the armed gesture kind.
        const effects: Effect[] = [
          {
            kind: 'click',
            gesture: state.gesture!,
            data: state.data,
            x: state.lastX,
            y: state.lastY,
            shift: !!mods.shift,
          },
        ];
        if (state.pointerId != null) effects.push({ kind: 'release', pointerId: state.pointerId });
        return { state: { ...IDLE }, effects };
      }
      if (state.phase === 'active') {
        if (e.pointerId != null && state.pointerId != null && e.pointerId !== state.pointerId) {
          return no(state);
        }
        const effects: Effect[] = [
          { kind: 'commit', gesture: state.gesture!, data: state.data, x: state.lastX, y: state.lastY },
        ];
        if (state.pointerId != null) effects.push({ kind: 'release', pointerId: state.pointerId });
        return {
          state: { ...IDLE, swallowNextClick: state.swallowTrailingClick },
          effects,
        };
      }
      if (state.phase === 'pinch' && state.pinch) {
        const { a, b } = state.pinch;
        if (e.pointerId !== a.id && e.pointerId !== b.id) return no(state);
        // One finger lifts: the survivor continues as a single-touch pan.
        const survivor = e.pointerId === a.id ? b : a;
        return {
          state: {
            ...IDLE,
            phase: 'active',
            gesture: 'pan',
            pointerId: survivor.id,
            pointerType: 'touch',
            startX: survivor.x,
            startY: survivor.y,
            lastX: survivor.x,
            lastY: survivor.y,
          },
          effects: [
            { kind: 'pinchEnd' },
            ...(e.pointerId != null ? [{ kind: 'release', pointerId: e.pointerId } as Effect] : []),
            { kind: 'begin', gesture: 'pan', data: null, x: survivor.x, y: survivor.y },
          ],
        };
      }
      return no(state);
    }

    case 'cancel':
    case 'lostcapture':
    case 'blur':
      return state.phase === 'idle' ? no({ ...state, swallowNextClick: false }) : toIdleCancel(state);

    case 'escape':
      // Escape cancels ONLY an in-flight gesture; armed-but-unmoved presses
      // cancel silently (no click). Idle Escape is not the machine's business
      // (the keyboard router walks its innermost chain instead).
      return state.phase === 'idle' ? no(state) : toIdleCancel(state);

    case 'nativeclick': {
      if (state.swallowNextClick) {
        return {
          state: { ...state, swallowNextClick: false },
          effects: [{ kind: 'swallowClick' }],
        };
      }
      return no(state);
    }

    default:
      return no(state);
  }
}

/** True when the machine owns an in-flight gesture (armed counts: a press is cancellable). */
export function hasActiveGesture(state: MachineState): boolean {
  return state.phase !== 'idle';
}
