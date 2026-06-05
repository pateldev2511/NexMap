import { describe, it, expect } from 'vitest';
import { History } from './history';
import {
  AddDeviceCommand,
  AddLinkCommand,
  MoveDeviceCommand,
  DeleteCommand,
  UpdateDeviceCommand,
  transaction,
} from './commands';
import { emptyModel, type ModelState } from './modelState';
import { createDevice, createLink } from '@/model/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const LAYER = 'L';

/** Stable snapshot for byte-for-byte state comparison. */
function snapshot(s: ModelState): string {
  const devices = [...s.devices.values()].sort((a, b) => a.id.localeCompare(b.id));
  const links = [...s.links.values()].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ devices, links });
}

describe('History — basic undo/redo', () => {
  it('undo reverses add; redo replays it', () => {
    const s = emptyModel(NOW);
    const h = new History();
    const before = snapshot(s);
    const d = createDevice('router', 10, 20, LAYER);
    h.dispatch(new AddDeviceCommand(d), s);
    expect(s.devices.size).toBe(1);
    h.undo(s);
    expect(snapshot(s)).toBe(before);
    h.redo(s);
    expect(s.devices.has(d.id)).toBe(true);
  });

  it('delete cascades links and undo restores both (DA-E6)', () => {
    const s = emptyModel(NOW);
    const h = new History();
    const a = createDevice('router', 0, 0, LAYER);
    const b = createDevice('switch', 100, 0, LAYER);
    h.dispatch(new AddDeviceCommand(a), s);
    h.dispatch(new AddDeviceCommand(b), s);
    const link = createLink(a.id, b.id, LAYER);
    h.dispatch(new AddLinkCommand(link), s);
    const full = snapshot(s);

    h.dispatch(new DeleteCommand([a.id]), s);
    expect(s.devices.has(a.id)).toBe(false);
    expect(s.links.has(link.id)).toBe(false); // cascaded
    expect(s.adjacency.get(b.id)?.has(link.id)).toBe(false); // adjacency cleaned

    h.undo(s);
    expect(snapshot(s)).toBe(full);
    expect(s.adjacency.get(b.id)?.has(link.id)).toBe(true); // adjacency restored
  });

  it('coalesces a drag stream into one undo entry', () => {
    const s = emptyModel(NOW);
    const h = new History();
    const d = createDevice('router', 0, 0, LAYER);
    h.dispatch(new AddDeviceCommand(d), s);
    const start = snapshot(s);
    for (let i = 1; i <= 20; i++) {
      h.dispatch(new MoveDeviceCommand(d.id, { x: i - 1, y: 0 }, { x: i, y: 0 }), s);
    }
    expect(s.devices.get(d.id)?.x).toBe(20);
    expect(h.depth).toBe(2); // add + one coalesced move
    h.undo(s); // undo the whole drag at once
    expect(snapshot(s)).toBe(start);
  });

  it('transaction is a single atomic undo entry', () => {
    const s = emptyModel(NOW);
    const h = new History();
    const a = createDevice('router', 0, 0, LAYER);
    const b = createDevice('switch', 50, 0, LAYER);
    const link = createLink(a.id, b.id, LAYER);
    const before = snapshot(s);
    h.dispatch(
      transaction('Import', [
        new AddDeviceCommand(a),
        new AddDeviceCommand(b),
        new AddLinkCommand(link),
      ]),
      s,
    );
    expect(s.devices.size).toBe(2);
    expect(s.links.size).toBe(1);
    expect(h.depth).toBe(1);
    h.undo(s);
    expect(snapshot(s)).toBe(before); // whole import rolled back atomically
  });

  it('new dispatch clears the redo stack', () => {
    const s = emptyModel(NOW);
    const h = new History();
    h.dispatch(new AddDeviceCommand(createDevice('router', 0, 0, LAYER)), s);
    h.undo(s);
    expect(h.canRedo).toBe(true);
    h.dispatch(new AddDeviceCommand(createDevice('switch', 0, 0, LAYER)), s);
    expect(h.canRedo).toBe(false);
  });
});

describe('History — property: undo-all === initial, redo-all === final', () => {
  it('survives a long random op sequence', () => {
    const s = emptyModel(NOW);
    // Uncapped: we're testing undo/redo correctness, not the bounded-history cap.
    const h = new History(100000);
    const initial = snapshot(s);
    const deviceIds: string[] = [];

    // Deterministic PRNG.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let step = 0; step < 400; step++) {
      const roll = rnd();
      if (roll < 0.4 || deviceIds.length === 0) {
        const d = createDevice(
          'router',
          Math.floor(rnd() * 500),
          Math.floor(rnd() * 500),
          LAYER,
        );
        h.dispatch(new AddDeviceCommand(d), s);
        deviceIds.push(d.id);
        h.commitCoalesceBoundary();
      } else if (roll < 0.65) {
        const id = deviceIds[Math.floor(rnd() * deviceIds.length)]!;
        const d = s.devices.get(id);
        if (d) {
          h.dispatch(
            new MoveDeviceCommand(id, { x: d.x, y: d.y }, { x: d.x + 10, y: d.y - 5 }),
            s,
          );
          h.commitCoalesceBoundary();
        }
      } else if (roll < 0.85) {
        const id = deviceIds[Math.floor(rnd() * deviceIds.length)]!;
        const d = s.devices.get(id);
        if (d) {
          h.dispatch(
            new UpdateDeviceCommand(id, { name: d.name }, { name: `n${step}` }),
            s,
          );
          h.commitCoalesceBoundary();
        }
      } else if (deviceIds.length > 1) {
        const a = deviceIds[Math.floor(rnd() * deviceIds.length)]!;
        const b = deviceIds[Math.floor(rnd() * deviceIds.length)]!;
        if (a !== b) {
          h.dispatch(new AddLinkCommand(createLink(a, b, LAYER)), s);
          h.commitCoalesceBoundary();
        }
      }
    }

    const final = snapshot(s);

    // Undo everything → back to initial.
    let guard = 0;
    while (h.canUndo && guard++ < 10000) h.undo(s);
    expect(snapshot(s)).toBe(initial);

    // Redo everything → back to final.
    guard = 0;
    while (h.canRedo && guard++ < 10000) h.redo(s);
    expect(snapshot(s)).toBe(final);
  });
});
