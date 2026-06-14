import { describe, it, expect } from 'vitest';
import { buildBom, bomCsv, bomLineName } from './rackBom';
import type { Device } from '@/model/types';

let n = 0;
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd' + n++, kind: 'device', type: 'server', name: 'd',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', ...over,
});

describe('buildBom', () => {
  it('collapses identical vendor+model+type into one line with summed qty/watts/weight', () => {
    const bom = buildBom([
      dev({ vendor: 'Dell', model: 'R660', watts: 400, weightKg: 20 }),
      dev({ vendor: 'Dell', model: 'R660', watts: 400, weightKg: 20 }),
    ]);
    expect(bom.lines).toHaveLength(1);
    expect(bom.lines[0]!.qty).toBe(2);
    expect(bom.lines[0]!.watts).toBe(800);
    expect(bom.lines[0]!.weightKg).toBe(40);
    expect(bom.totalDevices).toBe(2);
    expect(bom.totalWatts).toBe(800);
  });

  it('keeps different models on separate lines and groups unlabeled gear by type', () => {
    const bom = buildBom([
      dev({ vendor: 'Dell', model: 'R660' }),
      dev({ vendor: 'Arista', model: '7050' , type: 'switch' }),
      dev({ type: 'switch' }), // no vendor/model → groups by type
    ]);
    expect(bom.lines).toHaveLength(3);
  });

  it('sums cost only over priced devices and reports completeness', () => {
    const bom = buildBom([
      dev({ vendor: 'Dell', model: 'R660', priceUsd: 5000 }),
      dev({ vendor: 'Dell', model: 'R660' }), // unpriced
    ]);
    expect(bom.totalPriceUsd).toBe(5000);
    expect(bom.pricedCount).toBe(1);
    // The line mixes a priced + unpriced unit → line price is incomplete (undefined).
    expect(bom.lines[0]!.priceUsd).toBeUndefined();
  });

  it('a fully-priced line carries its line total', () => {
    const bom = buildBom([
      dev({ vendor: 'APC', model: 'PDU', priceUsd: 300 }),
      dev({ vendor: 'APC', model: 'PDU', priceUsd: 300 }),
    ]);
    expect(bom.lines[0]!.priceUsd).toBe(600);
    expect(bom.pricedCount).toBe(2);
  });

  it('handles an empty fleet', () => {
    const bom = buildBom([]);
    expect(bom.lines).toHaveLength(0);
    expect(bom.totalDevices).toBe(0);
    expect(bom.totalPriceUsd).toBe(0);
  });

  it('bomLineName falls back to the type default when vendor/model are blank', () => {
    expect(bomLineName({ key: 'k', vendor: '', model: '', type: 'switch', qty: 1, watts: 0, weightKg: 0 })).toBeTruthy();
    expect(bomLineName({ key: 'k', vendor: 'Dell', model: 'R660', type: 'server', qty: 1, watts: 0, weightKg: 0 })).toBe('Dell R660');
  });
});

describe('bomCsv', () => {
  it('emits a header, one row per line, and a totals row; injection-guarded', () => {
    const csv = bomCsv([
      dev({ vendor: '=Dell', model: 'R660', watts: 400, priceUsd: 5000 }),
    ]);
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('qty,vendor,model,type,watts,weight_kg,price_usd');
    expect(rows).toHaveLength(3); // header + 1 line + totals
    expect(rows[1]).toContain("'=Dell"); // formula injection neutralized
    expect(rows[2]).toContain('TOTAL');
    expect(rows[2]).toContain('5000.00');
  });
});
