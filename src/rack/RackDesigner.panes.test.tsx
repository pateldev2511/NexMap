/** Narrow-screen pane switcher (#89): ARIA, data-pane, and state that survives a switch. */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RackDesigner } from './RackDesigner';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();

function setup() {
  s().newProject('2026-01-01T00:00:00.000Z');
  const rackId = s().addRack('Rack A');
  const d = s().addDeviceAt('switch', 0, 0);
  s().placeInRack(d, rackId, { ru: 10, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
  return { d, ...render(<RackDesigner />) };
}
const root = (c: HTMLElement) => c.querySelector('[data-pane]') as HTMLElement;

describe('RackDesigner pane tabs', () => {
  beforeEach(() => {});

  it('renders an ARIA tablist with Library / Rack / Inspect and Rack selected', () => {
    setup();
    const list = screen.getByRole('tablist', { name: /panels/i });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Library', 'Rack', 'Inspect']);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    for (const t of tabs) {
      const target = document.getElementById(t.getAttribute('aria-controls')!);
      expect(target).toBeTruthy();
    }
  });

  it('clicking a tab sets data-pane and aria-selected', () => {
    const { container } = setup();
    expect(root(container).dataset.pane).toBe('rack');
    fireEvent.click(screen.getByRole('tab', { name: /Library/ }));
    expect(root(container).dataset.pane).toBe('library');
    expect(screen.getByRole('tab', { name: /Library/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Inspect/ }));
    expect(root(container).dataset.pane).toBe('inspect');
  });

  it('keeps selection, search text and panels mounted across a pane switch; badge shows count', () => {
    const { container, d } = setup();
    act(() => s().select([d]));
    const inspect = screen.getByRole('tab', { name: /Inspect/ });
    expect(inspect.getAttribute('aria-label')).toBe('Inspect, 1 selected');
    fireEvent.click(screen.getByRole('tab', { name: /Library/ }));
    fireEvent.change(screen.getByLabelText('Search device library'), { target: { value: 'dell' } });
    fireEvent.click(inspect);
    fireEvent.click(screen.getByRole('tab', { name: /Rack/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Library/ }));
    expect((screen.getByLabelText('Search device library') as HTMLInputElement).value).toBe('dell');
    expect([...s().selection]).toEqual([d]);
    expect(container.querySelector('#rack-pane-inspect')).toBeTruthy();
  });

  it('arming a library preset switches to the rack pane', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /Library/ }));
    const chip = document.querySelector('#rack-pane-library button[aria-pressed]') as HTMLElement;
    fireEvent.click(chip);
    expect(root(container).dataset.pane).toBe('rack');
  });

  it('Escape in the inspector returns to the rack', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /Inspect/ }));
    fireEvent.keyDown(document.getElementById('rack-pane-inspect')!, { key: 'Escape' });
    expect(root(container).dataset.pane).toBe('rack');
  });
});
