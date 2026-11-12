/**
 * Does a device belong in the logical network? A rack holds plenty that never will —
 * PDUs, cable managers, blanking panels — and validation shouldn't ask for links to them.
 *
 * Pure and derived: nothing is stored unless the user overrides the automatic answer
 * with `Device.topologyRole`.
 */
import { isCableManager } from '@/rack/panelKind';
import type { Device } from './types';

export type TopologyRoleInput = Pick<
  Device,
  'type' | 'name' | 'rackAccessory' | 'rackId' | 'interfaces' | 'topologyRole'
>;

/**
 * True when the device is expected to have links in the network diagram. An explicit
 * role wins (any other stored value is ignored, so a hand-edited file can't confuse it).
 * Otherwise power gear, patch panels, racks, cable managers and port-less generic rack
 * units (blanking and brush panels, shelves) are physical-only.
 */
export function expectsLogicalLinks(d: TopologyRoleInput): boolean {
  if (d.topologyRole === 'logical') return true;
  if (d.topologyRole === 'physical-only') return false;
  if (d.type === 'ups' || d.type === 'patch-panel' || d.type === 'rack') return false;
  if (isCableManager(d)) return false;
  if (d.type === 'generic' && d.rackId && (d.interfaces?.length ?? 0) === 0) return false;
  return true;
}
