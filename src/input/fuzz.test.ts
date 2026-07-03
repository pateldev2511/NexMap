import { describe, it, expect } from 'vitest';
import { reduce, IDLE, type MachineState, type MachineEvent, type Effect } from './machine';

/**
 * The "no stuck gesture, ever" guarantee, by force:
 *   1. the reducer NEVER throws, for any event in any state;
 *   2. from ANY reachable state, cancel followed by escape lands on idle
 *      with no dangling pointer captures (every capture eventually released).
 *
 * Seeded PRNG (mulberry32) — the seed prints on failure so any run is
 * reproducible. CI budget: thousands of sequences in well under 2s (pure fn).
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES: MachineEvent['type'][] = [
  'arm',
  'down',
  'move',
  'up',
  'cancel',
  'lostcapture',
  'escape',
  'blur',
  'nativeclick',
];
const GESTURES = ['drag', 'marquee', 'lasso', 'link', 'relink', 'resize', 'pan', 'cable'];
const POINTER_TYPES = ['mouse', 'pen', 'touch'] as const;

const pick = <T,>(arr: readonly T[], rnd: () => number): T =>
  arr[Math.floor(rnd() * arr.length)]!;

function randomEvent(rnd: () => number): MachineEvent {
  return {
    type: pick(TYPES, rnd),
    gesture: pick(GESTURES, rnd),
    data: { r: rnd() },
    pointerId: Math.floor(rnd() * 4),
    pointerType: pick(POINTER_TYPES, rnd),
    buttons: rnd() < 0.15 ? 0 : 1,
    button: Math.floor(rnd() * 3),
    x: rnd() * 2000 - 500,
    y: rnd() * 2000 - 500,
    immediate: rnd() < 0.2,
    swallowTrailingClick: rnd() < 0.3,
  };
}

function trackCaptures(captured: Set<number>, effects: Effect[]) {
  for (const ef of effects) {
    if (ef.kind === 'capture') captured.add(ef.pointerId);
    if (ef.kind === 'release') captured.delete(ef.pointerId);
  }
}

describe('fuzz: the reducer is total and always recoverable', () => {
  const SEED = 20260703;

  it(`survives 3000 random sequences (seed ${SEED})`, () => {
    const rnd = mulberry32(SEED);
    for (let seq = 0; seq < 3000; seq++) {
      let state: MachineState = IDLE;
      const captured = new Set<number>();
      const len = 1 + Math.floor(rnd() * 12);
      const trail: string[] = [];
      for (let i = 0; i < len; i++) {
        const e = randomEvent(rnd);
        trail.push(e.type);
        let r;
        try {
          r = reduce(state, e);
        } catch (err) {
          throw new Error(
            `reducer threw on seq ${seq} (seed ${SEED}) after [${trail.join(',')}]: ${err}`,
          );
        }
        state = r.state;
        trackCaptures(captured, r.effects);
      }
      // Recovery: cancel + escape from wherever we ended up → idle, captures drained.
      const c = reduce(state, { type: 'cancel' });
      trackCaptures(captured, c.effects);
      const esc = reduce(c.state, { type: 'escape' });
      trackCaptures(captured, esc.effects);
      expect(esc.state.phase, `seq ${seq} (seed ${SEED}) [${trail.join(',')}]`).toBe('idle');
      expect(
        [...captured],
        `dangling captures on seq ${seq} (seed ${SEED}) [${trail.join(',')}]`,
      ).toEqual([]);
    }
  });
});
