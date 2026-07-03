import { describe, it, expect } from 'vitest';
import {
  reduce,
  IDLE,
  CLICK_DRAG_THRESHOLD_PX,
  hasActiveGesture,
  type MachineState,
  type MachineEvent,
  type Effect,
} from './machine';

function run(events: MachineEvent[], from: MachineState = IDLE) {
  let state = from;
  const all: Effect[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    all.push(...r.effects);
  }
  return { state, effects: all };
}

const arm = (over: Partial<MachineEvent> = {}): MachineEvent => ({
  type: 'arm',
  gesture: 'drag',
  data: { id: 'dev1' },
  pointerId: 1,
  pointerType: 'mouse',
  x: 100,
  y: 100,
  ...over,
});

describe('lifecycle: idle → armed → active → commit', () => {
  it('press below threshold resolves as a CLICK on release', () => {
    const { state, effects } = run([
      arm(),
      { type: 'move', pointerId: 1, buttons: 1, x: 102, y: 101 },
      { type: 'up', pointerId: 1 },
    ]);
    expect(state.phase).toBe('idle');
    expect(effects.map((e) => e.kind)).toEqual(['capture', 'click', 'release']);
  });

  it('crossing 4 CSS px begins the gesture, release commits it', () => {
    const { state, effects } = run([
      arm(),
      { type: 'move', pointerId: 1, buttons: 1, x: 100 + CLICK_DRAG_THRESHOLD_PX + 1, y: 100 },
      { type: 'move', pointerId: 1, buttons: 1, x: 140, y: 130 },
      { type: 'up', pointerId: 1 },
    ]);
    expect(state.phase).toBe('idle');
    expect(effects.map((e) => e.kind)).toEqual([
      'capture',
      'begin',
      'update',
      'update',
      'commit',
      'release',
    ]);
    const upd = effects[3] as Extract<Effect, { kind: 'update' }>;
    expect(upd.dx).toBe(40);
    expect(upd.dy).toBe(30);
  });

  it('immediate arm (pan-style) begins without a threshold', () => {
    const { effects } = run([arm({ gesture: 'pan', immediate: true })]);
    expect(effects.map((e) => e.kind)).toEqual(['capture', 'begin']);
  });
});

describe('cancellation — the invariants that shipped broken twice', () => {
  it('pointercancel mid-drag cancels and releases', () => {
    const { state, effects } = run([
      arm(),
      { type: 'move', pointerId: 1, buttons: 1, x: 120, y: 120 },
      { type: 'cancel', pointerId: 1 },
    ]);
    expect(state).toEqual(IDLE);
    expect(effects.map((e) => e.kind)).toEqual(['capture', 'begin', 'update', 'cancel', 'release']);
  });

  it('lostpointercapture behaves exactly like pointercancel', () => {
    const { state } = run([arm(), { type: 'lostcapture' }]);
    expect(state).toEqual(IDLE);
  });

  it('Escape cancels an active gesture (and an armed press, silently)', () => {
    const active = run([arm(), { type: 'move', pointerId: 1, buttons: 1, x: 130, y: 130 }]);
    const r = reduce(active.state, { type: 'escape' });
    expect(r.state).toEqual(IDLE);
    expect(r.effects.some((e) => e.kind === 'cancel')).toBe(true);

    const armed = run([arm()]);
    const r2 = reduce(armed.state, { type: 'escape' });
    expect(r2.state).toEqual(IDLE);
    expect(r2.effects.some((e) => e.kind === 'click')).toBe(false); // no phantom click
  });

  it('a buttonless move kills the ghost gesture (missed release)', () => {
    const { state, effects } = run([
      arm(),
      { type: 'move', pointerId: 1, buttons: 0, x: 130, y: 130 },
    ]);
    expect(state).toEqual(IDLE);
    expect(effects.filter((e) => e.kind === 'release')).toHaveLength(1);
  });

  it('window blur mid-gesture cancels', () => {
    const { state } = run([arm(), { type: 'blur' }]);
    expect(state).toEqual(IDLE);
  });
});

describe('second-pointer policy', () => {
  it('touch second finger mid-drag cancels the drag and enters PINCH', () => {
    const { state, effects } = run([
      arm({ pointerType: 'touch' }),
      { type: 'move', pointerId: 1, x: 130, y: 130 },
      { type: 'down', pointerId: 2, pointerType: 'touch', x: 200, y: 200 },
    ]);
    expect(state.phase).toBe('pinch');
    expect(effects.some((e) => e.kind === 'cancel')).toBe(true);
    expect(effects.some((e) => e.kind === 'pinchStart')).toBe(true);
  });

  it('mouse second button mid-drag is ignored (captured gesture keeps ownership)', () => {
    const before = run([arm(), { type: 'move', pointerId: 1, buttons: 1, x: 130, y: 130 }]);
    const r = reduce(before.state, { type: 'down', pointerId: 2, pointerType: 'mouse', x: 0, y: 0 });
    expect(r.state).toBe(before.state);
    expect(r.effects).toEqual([]);
  });

  it('pinch: one finger lifting continues as single-touch pan', () => {
    const { state, effects } = run([
      arm({ pointerType: 'touch' }),
      { type: 'move', pointerId: 1, x: 130, y: 130 },
      { type: 'down', pointerId: 2, pointerType: 'touch', x: 200, y: 200 },
      { type: 'move', pointerId: 2, x: 210, y: 210 },
      { type: 'up', pointerId: 1 },
    ]);
    expect(state.phase).toBe('active');
    expect(state.gesture).toBe('pan');
    expect(effects.filter((e) => e.kind === 'pinchUpdate')).toHaveLength(1);
    expect(effects.some((e) => e.kind === 'pinchEnd')).toBe(true);
  });
});

describe('click swallowing is a machine state, not a boolean ref', () => {
  it('swallows exactly one trailing native click after a marquee-style commit', () => {
    const committed = run([
      arm({ gesture: 'marquee', swallowTrailingClick: true }),
      { type: 'move', pointerId: 1, buttons: 1, x: 200, y: 200 },
      { type: 'up', pointerId: 1 },
    ]);
    const first = reduce(committed.state, { type: 'nativeclick' });
    expect(first.effects).toEqual([{ kind: 'swallowClick' }]);
    const second = reduce(first.state, { type: 'nativeclick' });
    expect(second.effects).toEqual([]); // expired — never swallows a legit click
  });

  it('the swallow also expires on the next press (no stale one-shot)', () => {
    const committed = run([
      arm({ gesture: 'marquee', swallowTrailingClick: true }),
      { type: 'move', pointerId: 1, buttons: 1, x: 200, y: 200 },
      { type: 'up', pointerId: 1 },
    ]);
    const pressed = reduce(committed.state, arm());
    const clicked = reduce(pressed.state, { type: 'nativeclick' });
    expect(clicked.effects).toEqual([]);
  });
});

describe('defensive totality', () => {
  it('arming over an in-flight gesture cancels the old one first', () => {
    const inFlight = run([arm(), { type: 'move', pointerId: 1, buttons: 1, x: 150, y: 150 }]);
    const r = reduce(inFlight.state, arm({ pointerId: 3, gesture: 'marquee' }));
    expect(r.effects.some((e) => e.kind === 'cancel')).toBe(true);
    expect(r.state.gesture).toBe('marquee');
  });

  it('hasActiveGesture counts armed presses (they are cancellable)', () => {
    expect(hasActiveGesture(IDLE)).toBe(false);
    expect(hasActiveGesture(run([arm()]).state)).toBe(true);
  });
});
