/** Auto-layout by site (#90): one undoable move that keeps each Location together. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

function twoSites() {
  const ids: string[] = [];
  const add = (location: string | undefined, x: number, y: number) => {
    const id = s().addDeviceAt('switch', x, y);
    if (location) s().updateDevice(id, { location: undefined }, { location });
    ids.push(id);
    return id;
  };
  // Interleaved on purpose: a site's members start far apart.
  const hq = [add('HQ', 0, 0), add('HQ', 900, 700), add('HQ', 300, 50)];
  const dr = [add('DR', 500, 500), add('DR', 10, 800), add('DR', 700, 20)];
  const wan = add(undefined, 400, 400);
  s().endEdit();
  s().connect(hq[0]!, hq[1]!);
  s().connect(hq[0]!, hq[2]!);
  s().connect(dr[0]!, dr[1]!);
  s().connect(dr[0]!, dr[2]!);
  s().connect(wan, hq[0]!);
  s().connect(wan, dr[0]!);
  return { ids, hq, dr, wan };
}

const positions = (ids: string[]) => ids.map((id) => ({ x: s().getDevice(id)!.x, y: s().getDevice(id)!.y }));
const box = (ids: string[]) => {
  const ds = ids.map((id) => s().getDevice(id)!);
  return {
    x0: Math.min(...ds.map((d) => d.x)),
    y0: Math.min(...ds.map((d) => d.y)),
    x1: Math.max(...ds.map((d) => d.x + d.width)),
    y1: Math.max(...ds.map((d) => d.y + d.height)),
  };
};

describe('autoLayoutBySite', () => {
  it('gathers each site into its own block, and one undo puts every device back', () => {
    const { ids, hq, dr } = twoSites();
    const before = positions(ids);

    s().autoLayoutBySite();

    expect(positions(ids)).not.toEqual(before);
    const a = box(hq);
    const b = box(dr);
    expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);

    s().undo();
    expect(positions(ids)).toEqual(before);
    s().redo();
    expect(positions(ids)).not.toEqual(before);
  });

  it('leaves a locked device where it is', () => {
    const { ids, hq } = twoSites();
    s().updateDevice(hq[1]!, { locked: undefined }, { locked: true });
    s().endEdit();
    const before = positions(ids);
    s().autoLayoutBySite();
    expect(positions([hq[1]!])).toEqual([before[1]]);
    expect(positions(ids)).not.toEqual(before);
  });

  it('plain auto-layout still ignores Location', () => {
    const { ids } = twoSites();
    s().autoLayout();
    const plain = positions(ids);
    s().undo();
    for (const id of ids) s().updateDevice(id, {}, { location: undefined });
    s().endEdit();
    s().autoLayout();
    expect(positions(ids)).toEqual(plain);
  });
});
