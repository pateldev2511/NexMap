/**
 * Location navigator (W2b). Covers the three behaviours a regression would most
 * likely break and that the pure/store tests cannot see: the empty state (E17),
 * cycle-safe rendering (E12), and the blocked-delete explanation (E14).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useProjectStore } from '@/store/projectStore';
import { LocationsPanel } from './LocationsPanel';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => {
  cleanup();
  s().newProject(NOW);
});

describe('empty state (E17)', () => {
  it('explains the feature and offers to add a site', () => {
    render(<LocationsPanel />);
    expect(screen.getByText(/where they physically live/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first site' })).toBeInTheDocument();
  });

  it('offers no conversion when no rack carries legacy site text', () => {
    s().addRack('RK001');
    render(<LocationsPanel />);
    expect(screen.queryByText(/Convert/)).not.toBeInTheDocument();
  });

  it('adding a site from the empty state renders the tree', () => {
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add your first site' }));
    expect(s().locationsAll()).toHaveLength(1);
    expect(screen.getByDisplayValue('New site')).toBeInTheDocument();
  });
});

describe('site conversion offer', () => {
  it('labels racks AND sites accurately, deduping case-insensitively', () => {
    const r1 = s().addRack('RK001');
    const r2 = s().addRack('RK002');
    const r3 = s().addRack('RK003');
    s().updateRack(r1, {}, { site: 'HQ' });
    s().updateRack(r2, {}, { site: 'hq' });
    s().updateRack(r3, {}, { site: 'DR' });
    render(<LocationsPanel />);
    // 3 racks collapse to 2 distinct sites — the label must say so, not "3 sites".
    expect(screen.getByRole('button', { name: 'Convert 3 racks → 2 sites' })).toBeInTheDocument();
  });

  it('uses singular wording for a single rack and site', () => {
    const r1 = s().addRack('RK001');
    s().updateRack(r1, {}, { site: 'HQ' });
    render(<LocationsPanel />);
    expect(screen.getByRole('button', { name: 'Convert 1 rack → 1 site' })).toBeInTheDocument();
  });

  it('converting creates the sites and retires the offer', () => {
    const r1 = s().addRack('RK001');
    s().updateRack(r1, {}, { site: 'HQ' });
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Convert/ }));
    expect(s().locationsAll().map((l) => l.name)).toEqual(['HQ']);
    expect(screen.queryByText(/Convert/)).not.toBeInTheDocument();
    // The legacy text is never cleared.
    expect(s().racksAll()[0]!.site).toBe('HQ');
  });
});

describe('tree rendering', () => {
  it('renders nested rows with increasing indentation', () => {
    const hq = s().addLocation('HQ', 'site');
    const b1 = s().addLocation('Building 1', 'building', hq);
    s().addLocation('Floor 2', 'floor', b1);
    render(<LocationsPanel />);
    for (const name of ['HQ', 'Building 1', 'Floor 2']) {
      expect(screen.getByDisplayValue(name)).toBeInTheDocument();
    }
  });

  it('collapsing hides descendants but keeps the node', () => {
    const hq = s().addLocation('HQ', 'site');
    s().addLocation('Room 28', 'room', hq);
    render(<LocationsPanel />);
    expect(screen.getByDisplayValue('Room 28')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse HQ' }));
    expect(screen.queryByDisplayValue('Room 28')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('HQ')).toBeInTheDocument();
  });

  it('a leaf has no expand control', () => {
    s().addLocation('HQ', 'site');
    render(<LocationsPanel />);
    expect(screen.queryByRole('button', { name: /Collapse|Expand/ })).not.toBeInTheDocument();
  });

  it('adding a child defaults to the next rung down', () => {
    const hq = s().addLocation('HQ', 'site');
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a building inside HQ' }));
    const child = s().locationsAll().find((l) => l.parentId === hq)!;
    expect(child.kind).toBe('building');
  });

  it('renaming a row writes through to the model', () => {
    s().addLocation('HQ', 'site');
    render(<LocationsPanel />);
    fireEvent.change(screen.getByDisplayValue('HQ'), { target: { value: 'Head Office' } });
    expect(s().locationsAll()[0]!.name).toBe('Head Office');
  });

  it('shows occupancy counts for racks and devices', () => {
    const hq = s().addLocation('HQ', 'site');
    const rack = s().addRack('RK001');
    const d = s().addDeviceAt('switch', 0, 0);
    s().setRackLocation(rack, hq);
    s().setDeviceLocation(d, hq);
    render(<LocationsPanel />);
    expect(screen.getByTitle('1 rack(s), 1 device(s) here')).toBeInTheDocument();
  });

  // E12: the render path must be total. A cycle must not recurse forever.
  it('renders a cyclic tree without hanging, showing every node once', () => {
    const doc = s().getDocument();
    s().loadDoc({
      ...doc,
      locations: [
        { id: 'ok', name: 'Healthy', kind: 'site' },
        { id: 'a', name: 'A', kind: 'room', parentId: 'c' },
        { id: 'b', name: 'B', kind: 'room', parentId: 'a' },
        { id: 'c', name: 'C', kind: 'room', parentId: 'b' },
      ],
    });
    render(<LocationsPanel />);
    for (const name of ['Healthy', 'A', 'B', 'C']) {
      expect(screen.getAllByDisplayValue(name)).toHaveLength(1);
    }
  });

  // E13: a dangling parentId must not hide the node.
  it('shows an orphan rather than dropping it', () => {
    const doc = s().getDocument();
    s().loadDoc({
      ...doc,
      locations: [{ id: 'x', name: 'Stranded', kind: 'room', parentId: 'ghost' }],
    });
    render(<LocationsPanel />);
    expect(screen.getByDisplayValue('Stranded')).toBeInTheDocument();
  });
});

describe('delete (E14 — blocked, never cascaded)', () => {
  it('deletes an empty location', () => {
    s().addLocation('HQ', 'site');
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete HQ' }));
    expect(s().locationsAll()).toEqual([]);
  });

  it('refuses and explains what is still inside', () => {
    const hq = s().addLocation('HQ', 'site');
    s().addLocation('Room 28', 'room', hq);
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete HQ' }));
    expect(s().locationsAll()).toHaveLength(2);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('still holds 1 location');
  });

  it('counts racks and devices in the refusal', () => {
    const hq = s().addLocation('HQ', 'site');
    const rack = s().addRack('RK001');
    const d = s().addDeviceAt('switch', 0, 0);
    s().setRackLocation(rack, hq);
    s().setDeviceLocation(d, hq);
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete HQ' }));
    expect(screen.getByRole('status')).toHaveTextContent('still holds 1 rack, 1 device');
  });

  it('the refusal can be dismissed', () => {
    const hq = s().addLocation('HQ', 'site');
    s().addLocation('Room 28', 'room', hq);
    render(<LocationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete HQ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('clicking a row selects everything placed there', () => {
    const hq = s().addLocation('HQ', 'site');
    const d1 = s().addDeviceAt('switch', 0, 0);
    const d2 = s().addDeviceAt('server', 200, 0);
    s().setDeviceLocation(d1, hq);
    s().setDeviceLocation(d2, hq);
    render(<LocationsPanel />);
    fireEvent.click(screen.getByDisplayValue('HQ').closest('div')!);
    expect([...s().selection].sort()).toEqual([d1, d2].sort());
  });

  it('shows the derived qualified path, preferring codes over names', () => {
    const hq = s().addLocation('HQ', 'site');
    const room = s().addLocation('Room 28', 'room', hq);
    s().updateLocation(room, {}, { code: '28' });
    render(<LocationsPanel />);
    fireEvent.click(screen.getByDisplayValue('Room 28').closest('div')!);
    expect(screen.getByTitle('Fully-qualified path (derived)')).toHaveTextContent('HQ/28');
  });
});
