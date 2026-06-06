/**
 * Drag-to-relink store action: re-wire one link endpoint, clear its iface ref,
 * reject self-loops, single undo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('relinkEndpoint', () => {
  it('re-wires the source endpoint to a new device', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const c = s().addDeviceAt('server', 400, 0);
    const linkId = s().connect(a, b)!;
    const ok = s().relinkEndpoint(linkId, 'source', c);
    expect(ok).toBe(true);
    const link = s().linksAll()[0]!;
    expect(link.sourceId).toBe(c);
    expect(link.targetId).toBe(b);
  });

  it('clears the moved endpoint interface ref', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 200, 0);
    const c = s().addDeviceAt('server', 400, 0);
    const iface = s().addInterface(a, 'Gi0/1')!;
    const linkId = s().connect(a, b)!;
    s().updateLink(linkId, {}, { sourceIfaceId: iface, sourceInterface: 'Gi0/1' });
    s().relinkEndpoint(linkId, 'source', c);
    const link = s().linksAll()[0]!;
    expect(link.sourceIfaceId).toBeUndefined();
    expect(link.sourceInterface).toBeUndefined();
  });

  it('rejects a self-loop (new device == other endpoint)', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const linkId = s().connect(a, b)!;
    expect(s().relinkEndpoint(linkId, 'source', b)).toBe(false); // would make b—b
    expect(s().linksAll()[0]!.sourceId).toBe(a); // unchanged
  });

  it('is a no-op when the endpoint already points at the device', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const linkId = s().connect(a, b)!;
    expect(s().relinkEndpoint(linkId, 'source', a)).toBe(false);
  });

  it('is a single undoable step', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const c = s().addDeviceAt('server', 400, 0);
    const linkId = s().connect(a, b)!;
    s().relinkEndpoint(linkId, 'target', c);
    expect(s().linksAll()[0]!.targetId).toBe(c);
    s().undo();
    expect(s().linksAll()[0]!.targetId).toBe(b);
  });

  it('relinking onto an already-linked device makes a parallel member', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const c = s().addDeviceAt('server', 400, 0);
    s().connect(a, b);
    const l2 = s().connect(a, c)!;
    s().relinkEndpoint(l2, 'target', b); // now a—b twice (parallel)
    const ab = s().linksAll().filter((l) => l.targetId === b || l.sourceId === b);
    expect(ab.length).toBe(2);
  });
});
