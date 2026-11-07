import { describe, expect, it } from 'vitest';
import { MAX_QTY, parsePartsList, planMount } from './partsList';
import type { Device, Rack } from '@/model/types';

const one = (text: string) => parsePartsList(text)[0]!;

describe('parsePartsList · quantities', () => {
  it.each([
    ['2x Cisco Catalyst 9300-48P', 2],
    ['2 x Dell PowerEdge R750', 2],
    ['3 × firewall', 3],
    ['(4) Dell R650', 4],
    ['qty 2 Dell R650', 2],
    ['2 - Dell R650', 2],
    ['2 Dell R650', 2],
    ['Dell R650 x2', 2],
    ['Dell R650 (3)', 3],
    ['Dell R650', 1],
    ['2\tDell R650', 2],
  ])('%s → %d', (text, qty) => {
    expect(one(text).qty).toBe(qty);
  });

  it('a number that describes the item is not a quantity', () => {
    expect(one('24 port switch')).toMatchObject({ qty: 1, label: '24-port switch' });
    expect(one('Juniper MX204')).toMatchObject({ qty: 1, label: 'Juniper MX204' });
    expect(one('1U cable manager')).toMatchObject({ qty: 1, label: 'Cable manager' });
  });

  it('caps a runaway quantity', () => {
    expect(one('5000x patch panel').qty).toBe(MAX_QTY);
  });
});

describe('parsePartsList · what each line is', () => {
  it('names a catalog model, with its real height and specs', () => {
    expect(one('Cisco C9300-48P')).toMatchObject({ label: 'Cisco Catalyst 9300-48P', span: 1 });
    expect(one('Dell R750')).toMatchObject({ label: 'Dell PowerEdge R750', span: 2 });
    expect(one('APC Smart-UPS SRT 2200VA')).toMatchObject({ span: 2 });
    expect(one('Cisco Catalyst 9300-24T').catalog!.id).toBe('cisco-c9300-24t'); // not the 48P
  });

  it('falls back to a generic preset from what the line says', () => {
    const cases: [string, string][] = [
      ['48-port switch', '48-port switch'],
      ['16 port PoE switch', '16-port switch'],
      ['core switch 10G', 'Core switch (10G)'],
      ['24-port Cat6 patch panel', 'Patch panel (24)'], // generic — not silently a Panduit
      ['48 port patch panel', 'Patch panel (48)'],
      ['LC fiber patch panel', 'Fiber patch (24)'],
      ['1U horizontal cable manager', 'Cable manager'],
      ['vertical cable manager', 'Vertical cable manager (0U)'],
      ['0U cable manager', 'Vertical cable manager (0U)'],
      ['blanking panel', 'Blanking panel'],
      ['2U server', 'Server (2U)'],
      ['NAS', 'Storage / NAS (4U)'],
      ['UPS', 'UPS (2U)'],
      ['metered PDU', 'PDU (0U rail)'],
      ['edge router', 'Router'],
    ];
    for (const [text, label] of cases) expect([text, one(text).label]).toEqual([text, label]);
  });

  it('a PDU line keeps its stated rating; anything else, or half a rating, gets none', () => {
    expect(one('2x vertical PDU 30A 208V')).toMatchObject({ qty: 2, rating: { amps: 30, volts: 208 } });
    expect(one('PDU, 16 A, 230 V').rating).toEqual({ amps: 16, volts: 230, phases: 1 });
    expect(one('PDU 30A 208V 3-phase').rating).toEqual({ amps: 30, volts: 208, phases: 3 });
    expect(one('PDU three phase 16A 400V').rating?.phases).toBe(3);
    expect(one('PDU 3ph 32A 400V').rating?.phases).toBe(3);
    expect(one('3x PDU 30A 208V').rating?.phases).toBe(1); // a quantity of 3 is not three-phase
    expect(one('PDU 30A').rating).toBeUndefined();
    expect(one('server 2U 208V 10A').rating).toBeUndefined();
  });

  it('a UPS line keeps its stated output watts, never its VA', () => {
    expect(one('APC UPS 3000VA/2700W 2U').outputW).toBe(2700);
    expect(one('rack UPS 1500VA').outputW).toBeUndefined();
    expect(one('server 750W').outputW).toBeUndefined();
  });

  it('a "2U" on the line sets the height', () => {
    expect(one('shelf 3U').span).toBe(3);
  });

  it('reports what it can’t read instead of guessing; skips blanks, comments and headers', () => {
    const lines = parsePartsList('Qty\tDescription\n\n# rack 1\n- 2x Dell R650\nmystery widget\n');
    expect(lines.map((l) => [l.line, l.preset ? 'ok' : 'unknown'])).toEqual([
      [4, 'ok'],
      [5, 'unknown'],
    ]);
  });
});

describe('planMount', () => {
  const rack = (ruHeight = 42): Rack => ({ id: 'r1', name: 'MDF', ruHeight });
  const occupant = (ru: number, span = 1): Device => ({
    id: `o${ru}`,
    kind: 'device',
    type: 'server',
    name: `Existing ${ru}`,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    layerId: 'L',
    rackId: 'r1',
    ru,
    ruSpan: span,
  });

  it('stacks heaviest first from the bottom: UPS, compute, network, switches, patching', () => {
    const lines = parsePartsList('24-port patch panel\n2x 48 port switch\nfirewall\nDell R750\nUPS\nmetered PDU');
    const plan = planMount(rack(), [], lines);
    const order = plan.items.filter((i) => i.mount === 'rack').map((i) => `${i.line.label}@U${i.ru}`);
    expect(order).toEqual([
      'UPS (2U)@U1',
      'Dell PowerEdge R750@U3',
      'Firewall@U5',
      '48-port switch@U6',
      '48-port switch@U7',
      'Patch panel (24)@U8',
    ]);
    expect(plan.items.filter((i) => i.mount === 'rail').map((i) => i.side)).toEqual(['rear']);
    expect(plan.placed).toBe(7);
  });

  it('fills around what’s already in the rack, and says what doesn’t fit', () => {
    const plan = planMount(rack(4), [occupant(1, 2)], parsePartsList('3x Dell R650\nwidget'));
    expect(plan.items.map((i) => i.ru)).toEqual([3, 4, null]);
    expect(plan.noRoom).toHaveLength(1);
    expect(plan.unknown.map((l) => l.raw)).toEqual(['widget']);
  });

  it('a vertical manager runs the front rail full height; two PDUs become the rear A and B feeds', () => {
    const plan = planMount(rack(24), [], parsePartsList('2x metered PDU\nvertical cable manager'));
    const rails = plan.items.map((i) => [i.line.label, i.side, i.bay, i.ru, i.span]);
    expect(rails).toEqual([
      ['Vertical cable manager (0U)', 'front', 'right', 1, 24],
      ['PDU (0U rail)', 'rear', 'right', 1, 6],
      ['PDU (0U rail)', 'rear', 'left', 1, 6],
    ]);
    expect(plan.noRoom).toHaveLength(0);
  });

  it('a full-height PDU runs the rear rail; a plain PDU stays the short strip', () => {
    const plan = planMount(rack(24), [], parsePartsList('full height PDU\nvertical PDU\nPDU'));
    expect(plan.items.map((i) => [i.line.preset?.key, i.side, i.bay, i.ru, i.span])).toEqual([
      ['pdu-full', 'rear', 'right', 1, 24],
      ['pdu-full', 'rear', 'left', 1, 24],
      ['pdu', 'front', 'right', 1, 6],
    ]);
  });

  it('fills every rail channel before stacking two PDUs in one', () => {
    const plan = planMount(rack(24), [], parsePartsList('5x metered PDU'));
    expect(plan.items.map((i) => [i.side, i.bay, i.ru])).toEqual([
      ['rear', 'right', 1],
      ['rear', 'left', 1],
      ['front', 'right', 1],
      ['front', 'left', 1],
      ['rear', 'right', 7], // stacks above the first: a 6U strip leaves the channel's upper U free
    ]);
  });

  it('four full-height managers fill the four channels, and a fifth has no room', () => {
    const plan = planMount(rack(12), [], parsePartsList('5x vertical cable manager'));
    expect(plan.items.map((i) => [i.side, i.bay, i.ru])).toEqual([
      ['front', 'right', 1],
      ['front', 'left', 1],
      ['rear', 'right', 1],
      ['rear', 'left', 1],
      ['front', 'right', null],
    ]);
    expect(plan.noRoom).toHaveLength(1);
  });
});

describe('review fixes', () => {
  it('a hyphenated letter suffix is part of the model: a 9800-80 is not the 9800-L', () => {
    const [eighty, el] = parsePartsList('Cisco Catalyst 9800-80\nCisco Catalyst 9800-L');
    expect(eighty!.catalog?.model).not.toBe('Catalyst 9800-L');
    expect(el!.catalog?.model).toBe('Catalyst 9800-L');
  });

  it('a speed in the description is not a quantity', () => {
    expect(parsePartsList('10 GbE switch')[0]!.qty).toBe(1);
    expect(parsePartsList('10 GigE switch')[0]!.qty).toBe(1);
    expect(parsePartsList('2 Dell R750')[0]!.qty).toBe(2);
  });
});
