/**
 * Port scope + trace UI (W4). Asserts the things the pure trace tests cannot see:
 * that hops render as fully-qualified addresses, that clicking one navigates, that
 * the stop reason is always shown, and that a stale port ref degrades gracefully.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useProjectStore } from '@/store/projectStore';
import type { Slot } from '@/rack/rackModel';
import { Inspector } from './Inspector';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const dev = (name: string) => s().devicesAll().find((d) => d.name === name)!;

const slot = (ru: number): Slot => ({
  ru,
  ruSpan: 1,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  depth: 'shallow',
});

/**
 * SW01/Gi1/0/13 → PB001 front 13 ⇢ rear 13r → F830/01, all in HQ/28/RK001.
 * Returns the ids the tests need.
 */
function buildChain() {
  const hq = s().addLocation('HQ', 'site');
  s().updateLocation(hq, {}, { code: 'HQ' });
  const room = s().addLocation('Room 28', 'room', hq);
  s().updateLocation(room, {}, { code: '28' });
  const rack = s().addRack('RK001');
  s().setRackLocation(rack, room);

  const sw = s().addDeviceAt('switch', 0, 0);
  s().updateDevice(sw, {}, { name: 'SW01' });
  const swPort = s().addInterface(sw, 'Gi1/0/13')!;

  const pp = s().addDeviceAt('patch-panel', 100, 0);
  s().updateDevice(pp, {}, { name: 'PB001' });
  s().addInterface(pp, '13');
  s().pairPassThrough(pp);

  const wall = s().addDeviceAt('generic', 200, 0);
  s().updateDevice(wall, {}, { name: 'F830' });
  const wallPort = s().addInterface(wall, '01')!;

  s().placeInRack(sw, rack, slot(1));
  s().placeInRack(pp, rack, slot(2));
  s().placeInRack(wall, rack, slot(3));

  const ifs = dev('PB001').interfaces!;
  const front = ifs.find((i) => i.side === 'front')!;
  const rear = ifs.find((i) => i.side === 'rear')!;
  s().connectRackCable({ deviceId: sw, ifaceId: swPort }, { deviceId: pp, ifaceId: front.id }, '#0ff');
  s().connectRackCable({ deviceId: pp, ifaceId: rear.id }, { deviceId: wall, ifaceId: wallPort }, '#f90');

  return { sw, swPort, pp, front, rear, wall, wallPort };
}

beforeEach(() => {
  cleanup();
  s().newProject(NOW);
});

describe('drilling from Device scope into Port scope', () => {
  it('a port row offers a trace control', () => {
    const { sw } = buildChain();
    s().select([sw]);
    render(<Inspector />);
    expect(screen.getByRole('button', { name: 'Trace port Gi1/0/13' })).toBeInTheDocument();
  });

  it('clicking it switches the inspector to the port', () => {
    const { sw } = buildChain();
    s().select([sw]);
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Trace port Gi1/0/13' }));
    expect(s().selectedPort).toEqual({ deviceId: sw, ifaceId: dev('SW01').interfaces![0]!.id });
    expect(screen.getByText('Physical path')).toBeInTheDocument();
  });
});

describe('trace rendering', () => {
  it('shows every hop as a fully-qualified address', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    const hops = screen.getAllByRole('button', { name: /^Hop \d/ });
    expect(hops).toHaveLength(4);
    expect(hops.map((h) => h.textContent)).toEqual([
      '▸HQ/28/RK001/SW01/Gi1/0/13',
      '—HQ/28/RK001/PB001/13',
      '⇢HQ/28/RK001/PB001/13r',
      '—HQ/28/RK001/F830/01',
    ]);
  });

  it('reports a clean end-to-end trace', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    expect(screen.getByRole('status')).toHaveTextContent('Traced end to end');
  });

  it('clicking a hop navigates to that port AND selects its device', () => {
    const { sw, swPort, wall, wallPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    const hops = screen.getAllByRole('button', { name: /^Hop \d/ });
    fireEvent.click(hops[hops.length - 1]!);
    expect(s().selectedPort).toEqual({ deviceId: wall, ifaceId: wallPort });
    expect(s().selection.has(wall)).toBe(true);
  });

  it('the trace reverses when viewed from the far end', () => {
    const { wall, wallPort } = buildChain();
    s().select([wall]);
    s().selectPort(wall, wallPort);
    render(<Inspector />);
    const hops = screen.getAllByRole('button', { name: /^Hop \d/ });
    expect(hops.map((h) => h.textContent)).toEqual([
      '▸HQ/28/RK001/F830/01',
      '—HQ/28/RK001/PB001/13r',
      '⇢HQ/28/RK001/PB001/13',
      '—HQ/28/RK001/SW01/Gi1/0/13',
    ]);
  });

  it('marks the hop you are currently on', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    const hops = screen.getAllByRole('button', { name: /^Hop \d/ });
    const current = hops.filter((h) => h.className.includes('current'));
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('SW01/Gi1/0/13');
  });
});

describe('honest failure reporting', () => {
  it('an unpatched port says the path ends, and is not an error', () => {
    const sw = s().addDeviceAt('switch', 0, 0);
    const p = s().addInterface(sw, 'Gi0/1')!;
    s().select([sw]);
    s().selectPort(sw, p);
    render(<Inspector />);
    expect(screen.getByRole('status')).toHaveTextContent('nothing patched onward');
    expect(screen.getAllByRole('button', { name: /^Hop \d/ })).toHaveLength(1);
  });

  it('a broken pass-through stops at the panel instead of crossing it', () => {
    const { sw, swPort, pp, rear } = buildChain();
    // Break one half, exactly as a hand-edited file could.
    s().updateInterface(pp, rear.id, { throughTo: undefined });
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    const hops = screen.getAllByRole('button', { name: /^Hop \d/ });
    // Two hops only — it must NOT reach F830 through a half-existing pair.
    expect(hops).toHaveLength(2);
    expect(hops.map((h) => h.textContent).join()).not.toContain('F830');
    expect(screen.getByRole('status')).toHaveTextContent('nothing patched onward');
  });

  // Defence in depth: the store REFUSES a second cable on an occupied port
  // (rackCables.checkConnect), so `ambiguous` is unreachable through the API and can
  // only arrive in a hand-edited or corrupt file. Both halves are asserted.
  it('the store refuses a second cable on an already-cabled port', () => {
    const { sw, swPort, wall, wallPort } = buildChain();
    const before = s().rackCablesAll().length;
    const second = s().connectRackCable(
      { deviceId: sw, ifaceId: swPort },
      { deviceId: wall, ifaceId: wallPort },
      '#f00',
    );
    expect(second).toBeNull();
    expect(s().rackCablesAll()).toHaveLength(before);
  });

  it('reports ambiguity when a corrupt file DOES double-cable a port', () => {
    const { sw, swPort, wall, wallPort } = buildChain();
    const doc = s().getDocument();
    // Bypass checkConnect the way a hand-edited .nexmap would.
    s().loadDoc({
      ...doc,
      rackCables: [
        ...doc.rackCables,
        {
          id: 'rogue',
          aEnd: { deviceId: sw, ifaceId: swPort },
          bEnd: { deviceId: wall, ifaceId: wallPort },
          color: '#f00',
        },
      ],
    });
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    expect(screen.getByRole('status')).toHaveTextContent('more than one cable');
  });
});

describe('port fields', () => {
  it('edits write through to the model', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText('Media / kind'), { target: { value: 'LC/UPC' } });
    expect(dev('SW01').interfaces![0]!.kind).toBe('LC/UPC');
  });

  it('offers a jump to the coupled port on the other face', () => {
    const { pp, front, rear } = buildChain();
    s().select([pp]);
    s().selectPort(pp, front.id);
    render(<Inspector />);
    fireEvent.click(screen.getByTitle('Jump to the coupled port on the other face'));
    expect(s().selectedPort).toEqual({ deviceId: pp, ifaceId: rear.id });
  });

  it('says so when a pass-through points nowhere, instead of rendering blank', () => {
    const { pp, front } = buildChain();
    s().updateInterface(pp, front.id, { throughTo: 'ghost' });
    s().select([pp]);
    s().selectPort(pp, front.id);
    render(<Inspector />);
    expect(screen.getByText(/does not resolve/)).toBeInTheDocument();
  });
});

describe('scope precedence and stale refs', () => {
  it('the port scope wins over the device scope', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    render(<Inspector />);
    expect(screen.getByText('Physical path')).toBeInTheDocument();
    // Device-only sections are not shown while a port is focused.
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument();
  });

  it('selecting on the canvas clears the port scope', () => {
    const { sw, swPort, wall } = buildChain();
    s().selectPort(sw, swPort);
    s().select([wall]);
    expect(s().selectedPort).toBeNull();
  });

  it('a stale port ref falls back to the device scope rather than rendering blank', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    // Delete the interface out from under the scope.
    s().deleteInterface(sw, swPort);
    expect(s().selectedPort).not.toBeNull(); // deliberately still set
    render(<Inspector />);
    expect(screen.queryByText('Physical path')).not.toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });

  it('deleting the device clears the port scope outright', () => {
    const { sw, swPort } = buildChain();
    s().select([sw]);
    s().selectPort(sw, swPort);
    s().deleteSelection();
    expect(s().selectedPort).toBeNull();
  });
});
