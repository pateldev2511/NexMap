import { describe, it, expect } from 'vitest';
import { planTwin } from './redundancy';

const link = (sourceId: string, targetId: string) => ({ sourceId, targetId });

describe('planTwin', () => {
  it('inherits the device neighbors as parallel paths', () => {
    // core sits between up and two downstreams.
    const links = [link('up', 'core'), link('core', 'a'), link('core', 'b')];
    const plan = planTwin('core', links)!;
    expect(plan.deviceId).toBe('core');
    expect([...plan.neighborIds].sort()).toEqual(['a', 'b', 'up']);
  });

  it('is direction-agnostic (neighbor on either end of a link)', () => {
    const plan = planTwin('core', [link('core', 'x'), link('y', 'core')])!;
    expect([...plan.neighborIds].sort()).toEqual(['x', 'y']);
  });

  it('de-duplicates a neighbor reached by multiple links', () => {
    const plan = planTwin('core', [link('core', 'x'), link('x', 'core')])!;
    expect(plan.neighborIds).toEqual(['x']);
  });

  it('returns null when the device has no neighbors (a twin would be an island)', () => {
    expect(planTwin('lonely', [])).toBeNull();
    expect(planTwin('lonely', [link('a', 'b')])).toBeNull();
  });

  it('ignores a self-loop rather than twinning the device to itself', () => {
    expect(planTwin('core', [link('core', 'core')])).toBeNull();
    const plan = planTwin('core', [link('core', 'core'), link('core', 'x')])!;
    expect(plan.neighborIds).toEqual(['x']);
  });
});
