import { describe, expect, it } from 'vitest';
import { firstSelectable, nextSelectable } from './commandPaletteNav';

const items = (flags: boolean[]) => flags.map((disabled) => ({ disabled }));

describe('firstSelectable', () => {
  it('finds the first runnable command', () => {
    expect(firstSelectable(items([true, true, false, false]))).toBe(2);
  });

  it('returns 0 when the first is runnable', () => {
    expect(firstSelectable(items([false, true]))).toBe(0);
  });

  it('returns -1 when every command is disabled', () => {
    expect(firstSelectable(items([true, true]))).toBe(-1);
  });
});

describe('nextSelectable', () => {
  const list = items([false, true, true, false, true]); // runnable: 0, 3

  it('skips disabled rows moving down', () => {
    expect(nextSelectable(list, 0, 1)).toBe(3);
  });

  it('skips disabled rows moving up', () => {
    expect(nextSelectable(list, 3, -1)).toBe(0);
  });

  it('clamps at the end — keeps position when nothing runnable is further down', () => {
    expect(nextSelectable(list, 3, 1)).toBe(3); // index 4 is disabled, no runnable beyond
  });

  it('clamps at the start — keeps position when nothing runnable is above', () => {
    expect(nextSelectable(list, 0, -1)).toBe(0);
  });

  it('steps between adjacent runnable rows', () => {
    const adj = items([false, false, false]);
    expect(nextSelectable(adj, 0, 1)).toBe(1);
    expect(nextSelectable(adj, 2, -1)).toBe(1);
  });
});
