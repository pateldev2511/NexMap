import { describe, it, expect } from 'vitest';
import { normalizeRect, rectsIntersect, devicesInMarquee, type Box } from './marquee';

describe('normalizeRect', () => {
  it('normalizes regardless of drag direction', () => {
    expect(normalizeRect(10, 10, 30, 40)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
    expect(normalizeRect(30, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});

describe('rectsIntersect', () => {
  const a: Box = { x: 0, y: 0, w: 10, h: 10 };
  it('overlapping → true', () => expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true));
  it('disjoint → false', () => expect(rectsIntersect(a, { x: 20, y: 20, w: 5, h: 5 })).toBe(false));
  it('touching edge → false', () => expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false));
});

describe('devicesInMarquee', () => {
  const rects = [
    { id: 'a', box: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'b', box: { x: 100, y: 100, w: 10, h: 10 } },
    { id: 'c', box: { x: 5, y: 5, w: 10, h: 10 } },
  ];
  it('returns ids overlapping the marquee, in input order', () => {
    expect(devicesInMarquee(rects, { x: -5, y: -5, w: 20, h: 20 })).toEqual(['a', 'c']);
  });
  it('a big marquee grabs everything', () => {
    expect(devicesInMarquee(rects, { x: -10, y: -10, w: 200, h: 200 })).toEqual(['a', 'b', 'c']);
  });
  it('a zero-area marquee selects nothing (a plain click is not a marquee)', () => {
    expect(devicesInMarquee(rects, { x: 5, y: 5, w: 0, h: 0 })).toEqual([]);
  });
  it('an empty rect list selects nothing', () => {
    expect(devicesInMarquee([], { x: 0, y: 0, w: 50, h: 50 })).toEqual([]);
  });
});
