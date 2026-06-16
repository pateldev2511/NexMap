import { describe, it, expect } from 'vitest';
import { airflowViolations, airflowOf } from './rackAirflow';
import type { Device } from '@/model/types';

let n = 0;
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd' + n++, kind: 'device', type: 'server', name: 'd',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', ...over,
});

describe('airflowOf', () => {
  it('defaults to front-to-rear', () => {
    expect(airflowOf(dev())).toBe('front-to-rear');
    expect(airflowOf(dev({ airflow: 'rear-to-front' }))).toBe('rear-to-front');
  });
});

describe('airflowViolations', () => {
  it('no violations when all gear flows the same way', () => {
    expect(airflowViolations([dev(), dev(), dev()])).toEqual([]);
    expect(airflowViolations([dev({ airflow: 'rear-to-front' }), dev({ airflow: 'rear-to-front' })])).toEqual([]);
  });

  it('flags the minority direction as the violation', () => {
    const bad = dev({ id: 'bad', airflow: 'rear-to-front' });
    const v = airflowViolations([dev(), dev(), bad]);
    expect(v).toHaveLength(1);
    expect(v[0]!.deviceId).toBe('bad');
    expect(v[0]!.dominant).toBe('front-to-rear');
  });

  it('on a tie, front-to-rear wins and rear-to-front is the violation', () => {
    const v = airflowViolations([dev({ airflow: 'front-to-rear' }), dev({ id: 'r', airflow: 'rear-to-front' })]);
    expect(v.map((x) => x.deviceId)).toEqual(['r']);
  });

  it('ignores side-airflow gear (neither dominant nor a violation)', () => {
    const v = airflowViolations([dev(), dev({ airflow: 'side' }), dev({ airflow: 'side' })]);
    expect(v).toEqual([]);
  });

  it('empty set → no violations', () => {
    expect(airflowViolations([])).toEqual([]);
  });
});
