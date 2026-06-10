/**
 * Inverse-based command pattern (eng review DA-A1).
 *
 * Each command knows how to `apply` and `undo` itself against ModelState. This is
 * chosen over whole-document snapshots because a 1k-object import snapshot per
 * history entry would blow memory at the stated scale. `mergeWith` lets streams of
 * tiny edits (a drag = dozens of moves) coalesce into one undo entry.
 *
 * `transaction()` composes sub-commands into a single atomic history entry — the
 * basis for build-draft-then-commit import (DA-T2): the whole import is one undo.
 */
import type {
  CanvasObject,
  Device,
  Layer,
  Link,
  Rack,
  RackCable,
  Subnet,
  Vlan,
} from '@/model/types';
import {
  addDevice,
  addLink,
  linksForDevice,
  removeDevice,
  removeLink,
  type ModelState,
} from './modelState';

export interface Command {
  readonly label: string;
  apply(state: ModelState): void;
  undo(state: ModelState): void;
  /**
   * If this command can absorb `next` (same kind, same target, contiguous in
   * time), return the merged command; otherwise null. Both have already been
   * applied to state when this is called, so the merged command's undo must
   * restore the state from BEFORE this command.
   */
  mergeWith?(next: Command): Command | null;
}

export class AddDeviceCommand implements Command {
  readonly label = 'Add device';
  constructor(private readonly device: Device) {}
  apply(s: ModelState) {
    addDevice(s, this.device);
  }
  undo(s: ModelState) {
    removeDevice(s, this.device.id);
  }
}

export class AddLinkCommand implements Command {
  readonly label = 'Connect devices';
  constructor(private readonly link: Link) {}
  apply(s: ModelState) {
    addLink(s, this.link);
  }
  undo(s: ModelState) {
    removeLink(s, this.link.id);
  }
}

export class MoveDeviceCommand implements Command {
  readonly label = 'Move device';
  constructor(
    private readonly id: string,
    private readonly from: { x: number; y: number },
    private readonly to: { x: number; y: number },
  ) {}
  apply(s: ModelState) {
    const d = s.devices.get(this.id);
    if (d) s.devices.set(this.id, { ...d, x: this.to.x, y: this.to.y });
  }
  undo(s: ModelState) {
    const d = s.devices.get(this.id);
    if (d) s.devices.set(this.id, { ...d, x: this.from.x, y: this.from.y });
  }
  mergeWith(next: Command): Command | null {
    if (next instanceof MoveDeviceCommand && next.id === this.id) {
      // Keep this command's original `from`, take the latest `to`.
      return new MoveDeviceCommand(this.id, this.from, next.to);
    }
    return null;
  }
}

export class UpdateDeviceCommand implements Command {
  readonly label = 'Edit device';
  constructor(
    private readonly id: string,
    private readonly before: Partial<Device>,
    private readonly after: Partial<Device>,
  ) {}
  apply(s: ModelState) {
    const d = s.devices.get(this.id);
    if (d) s.devices.set(this.id, { ...d, ...this.after });
  }
  undo(s: ModelState) {
    const d = s.devices.get(this.id);
    if (d) s.devices.set(this.id, { ...d, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    // Coalesce successive edits to the same field(s) on the same device (typing).
    if (
      next instanceof UpdateDeviceCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateDeviceCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class UpdateLinkCommand implements Command {
  readonly label = 'Edit link';
  constructor(
    private readonly id: string,
    private readonly before: Partial<Link>,
    private readonly after: Partial<Link>,
  ) {}
  apply(s: ModelState) {
    const l = s.links.get(this.id);
    if (l) s.links.set(this.id, { ...l, ...this.after });
  }
  undo(s: ModelState) {
    const l = s.links.get(this.id);
    if (l) s.links.set(this.id, { ...l, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateLinkCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateLinkCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class RenameProjectCommand implements Command {
  readonly label = 'Rename project';
  constructor(
    private readonly before: string,
    private readonly after: string,
  ) {}
  apply(s: ModelState) {
    s.project = { ...s.project, name: this.after };
  }
  undo(s: ModelState) {
    s.project = { ...s.project, name: this.before };
  }
  mergeWith(next: Command): Command | null {
    if (next instanceof RenameProjectCommand) {
      return new RenameProjectCommand(this.before, next.after);
    }
    return null;
  }
}

/**
 * Delete devices (and cascade their incident links) atomically. Captures the full
 * removed set at apply-time so undo restores devices AND links exactly (DA-E6).
 */
export class DeleteCommand implements Command {
  readonly label = 'Delete';
  private removedDevices: Device[] = [];
  private removedLinks: Link[] = [];
  private removedObjects: CanvasObject[] = [];
  /** Physical rack cables cascade-removed with their deleted devices (schema v3). */
  private removedCables: RackCable[] = [];
  constructor(
    private readonly deviceIds: string[],
    private readonly explicitLinkIds: string[] = [],
    private readonly objectIds: string[] = [],
  ) {}
  apply(s: ModelState) {
    // Recompute the removed set on (re-)apply so redo after edits stays correct.
    const linkIds = new Set(this.explicitLinkIds);
    for (const id of this.deviceIds) {
      for (const lid of linksForDevice(s, id)) linkIds.add(lid);
    }
    this.removedLinks = [...linkIds].map((id) => s.links.get(id)).filter(isLink);
    this.removedDevices = this.deviceIds.map((id) => s.devices.get(id)).filter(isDevice);
    this.removedObjects = this.objectIds.map((id) => s.objects.get(id)).filter(isObject);
    // Cascade-prune rack cables touching any deleted device (no dangling endpoints).
    const deviceIdSet = new Set(this.removedDevices.map((d) => d.id));
    this.removedCables = [...s.rackCables.values()].filter((c) =>
      deviceIdSet.has(c.aEnd.deviceId) || deviceIdSet.has(c.bEnd.deviceId),
    );
    for (const cable of this.removedCables) s.rackCables.delete(cable.id);
    for (const link of this.removedLinks) removeLink(s, link.id);
    for (const device of this.removedDevices) removeDevice(s, device.id);
    for (const obj of this.removedObjects) s.objects.delete(obj.id);
  }
  undo(s: ModelState) {
    for (const device of this.removedDevices) addDevice(s, device);
    for (const link of this.removedLinks) addLink(s, link);
    for (const obj of this.removedObjects) s.objects.set(obj.id, obj);
    for (const cable of this.removedCables) s.rackCables.set(cable.id, cable);
  }
}

export class AddObjectCommand implements Command {
  readonly label = 'Add object';
  constructor(private readonly obj: CanvasObject) {}
  apply(s: ModelState) {
    s.objects.set(this.obj.id, this.obj);
  }
  undo(s: ModelState) {
    s.objects.delete(this.obj.id);
  }
}

export class MoveObjectCommand implements Command {
  readonly label = 'Move object';
  constructor(
    private readonly id: string,
    private readonly from: { x: number; y: number },
    private readonly to: { x: number; y: number },
  ) {}
  apply(s: ModelState) {
    const o = s.objects.get(this.id);
    if (o) s.objects.set(this.id, { ...o, x: this.to.x, y: this.to.y });
  }
  undo(s: ModelState) {
    const o = s.objects.get(this.id);
    if (o) s.objects.set(this.id, { ...o, x: this.from.x, y: this.from.y });
  }
  mergeWith(next: Command): Command | null {
    if (next instanceof MoveObjectCommand && next.id === this.id) {
      return new MoveObjectCommand(this.id, this.from, next.to);
    }
    return null;
  }
}

export class UpdateObjectCommand implements Command {
  readonly label = 'Edit object';
  constructor(
    private readonly id: string,
    private readonly before: Partial<CanvasObject>,
    private readonly after: Partial<CanvasObject>,
  ) {}
  apply(s: ModelState) {
    const o = s.objects.get(this.id);
    if (o) s.objects.set(this.id, { ...o, ...this.after } as CanvasObject);
  }
  undo(s: ModelState) {
    const o = s.objects.get(this.id);
    if (o) s.objects.set(this.id, { ...o, ...this.before } as CanvasObject);
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateObjectCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateObjectCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class AddLayerCommand implements Command {
  readonly label = 'Add layer';
  constructor(private readonly layer: Layer) {}
  apply(s: ModelState) {
    s.layers.set(this.layer.id, this.layer);
  }
  undo(s: ModelState) {
    s.layers.delete(this.layer.id);
  }
}

export class UpdateLayerCommand implements Command {
  readonly label = 'Edit layer';
  constructor(
    private readonly id: string,
    private readonly before: Partial<Layer>,
    private readonly after: Partial<Layer>,
  ) {}
  apply(s: ModelState) {
    const layer = s.layers.get(this.id);
    if (layer) s.layers.set(this.id, { ...layer, ...this.after });
  }
  undo(s: ModelState) {
    const layer = s.layers.get(this.id);
    if (layer) s.layers.set(this.id, { ...layer, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateLayerCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateLayerCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class DeleteLayerCommand implements Command {
  readonly label = 'Delete layer';
  private removed?: Layer;
  private movedDevices: Array<{ id: string; layerId: string }> = [];
  private movedLinks: Array<{ id: string; layerId: string }> = [];
  private movedObjects: Array<{ id: string; layerId: string }> = [];

  constructor(
    private readonly id: string,
    private readonly fallbackId: string,
  ) {}

  apply(s: ModelState) {
    this.removed = s.layers.get(this.id);
    this.movedDevices = [];
    this.movedLinks = [];
    this.movedObjects = [];
    if (!this.removed) return;
    for (const d of s.devices.values()) {
      if (d.layerId !== this.id) continue;
      this.movedDevices.push({ id: d.id, layerId: d.layerId });
      s.devices.set(d.id, { ...d, layerId: this.fallbackId });
    }
    for (const l of s.links.values()) {
      if (l.layerId !== this.id) continue;
      this.movedLinks.push({ id: l.id, layerId: l.layerId });
      s.links.set(l.id, { ...l, layerId: this.fallbackId });
    }
    for (const o of s.objects.values()) {
      if (o.layerId !== this.id) continue;
      this.movedObjects.push({ id: o.id, layerId: o.layerId });
      s.objects.set(o.id, { ...o, layerId: this.fallbackId } as CanvasObject);
    }
    s.layers.delete(this.id);
  }

  undo(s: ModelState) {
    if (this.removed) s.layers.set(this.removed.id, this.removed);
    for (const moved of this.movedDevices) {
      const d = s.devices.get(moved.id);
      if (d) s.devices.set(d.id, { ...d, layerId: moved.layerId });
    }
    for (const moved of this.movedLinks) {
      const l = s.links.get(moved.id);
      if (l) s.links.set(l.id, { ...l, layerId: moved.layerId });
    }
    for (const moved of this.movedObjects) {
      const o = s.objects.get(moved.id);
      if (o) s.objects.set(o.id, { ...o, layerId: moved.layerId } as CanvasObject);
    }
  }
}

// --- VLAN / Subnet list-entity commands (Phase 4) ---

export class AddVlanCommand implements Command {
  readonly label = 'Add VLAN';
  constructor(private readonly v: Vlan) {}
  apply(s: ModelState) {
    s.vlans.set(this.v.id, this.v);
  }
  undo(s: ModelState) {
    s.vlans.delete(this.v.id);
  }
}

export class UpdateVlanCommand implements Command {
  readonly label = 'Edit VLAN';
  constructor(
    private readonly id: string,
    private readonly before: Partial<Vlan>,
    private readonly after: Partial<Vlan>,
  ) {}
  apply(s: ModelState) {
    const v = s.vlans.get(this.id);
    if (v) s.vlans.set(this.id, { ...v, ...this.after });
  }
  undo(s: ModelState) {
    const v = s.vlans.get(this.id);
    if (v) s.vlans.set(this.id, { ...v, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateVlanCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateVlanCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class DeleteVlanCommand implements Command {
  readonly label = 'Delete VLAN';
  private removed?: Vlan;
  constructor(private readonly id: string) {}
  apply(s: ModelState) {
    this.removed = s.vlans.get(this.id);
    s.vlans.delete(this.id);
  }
  undo(s: ModelState) {
    if (this.removed) s.vlans.set(this.id, this.removed);
  }
}

export class AddSubnetCommand implements Command {
  readonly label = 'Add subnet';
  constructor(private readonly sub: Subnet) {}
  apply(s: ModelState) {
    s.subnets.set(this.sub.id, this.sub);
  }
  undo(s: ModelState) {
    s.subnets.delete(this.sub.id);
  }
}

export class UpdateSubnetCommand implements Command {
  readonly label = 'Edit subnet';
  constructor(
    private readonly id: string,
    private readonly before: Partial<Subnet>,
    private readonly after: Partial<Subnet>,
  ) {}
  apply(s: ModelState) {
    const sub = s.subnets.get(this.id);
    if (sub) s.subnets.set(this.id, { ...sub, ...this.after });
  }
  undo(s: ModelState) {
    const sub = s.subnets.get(this.id);
    if (sub) s.subnets.set(this.id, { ...sub, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateSubnetCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateSubnetCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class DeleteSubnetCommand implements Command {
  readonly label = 'Delete subnet';
  private removed?: Subnet;
  constructor(private readonly id: string) {}
  apply(s: ModelState) {
    this.removed = s.subnets.get(this.id);
    s.subnets.delete(this.id);
  }
  undo(s: ModelState) {
    if (this.removed) s.subnets.set(this.id, this.removed);
  }
}

export class AddRackCommand implements Command {
  readonly label = 'Add rack';
  constructor(private readonly r: Rack) {}
  apply(s: ModelState) {
    s.racks.set(this.r.id, this.r);
  }
  undo(s: ModelState) {
    s.racks.delete(this.r.id);
  }
}

export class UpdateRackCommand implements Command {
  readonly label = 'Edit rack';
  constructor(
    private readonly id: string,
    private readonly before: Partial<Rack>,
    private readonly after: Partial<Rack>,
  ) {}
  apply(s: ModelState) {
    const r = s.racks.get(this.id);
    if (r) s.racks.set(this.id, { ...r, ...this.after });
  }
  undo(s: ModelState) {
    const r = s.racks.get(this.id);
    if (r) s.racks.set(this.id, { ...r, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateRackCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateRackCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class DeleteRackCommand implements Command {
  readonly label = 'Delete rack';
  private removed?: Rack;
  constructor(private readonly id: string) {}
  apply(s: ModelState) {
    this.removed = s.racks.get(this.id);
    s.racks.delete(this.id);
  }
  undo(s: ModelState) {
    if (this.removed) s.racks.set(this.id, this.removed);
  }
}

// ─── Rack cables (schema v3) ─────────────────────────────────────────────────
// Physical patch cables live in their own collection, mutated directly on the
// rackCables Map (like objects/vlans), separate from the logical link graph.

export class AddRackCableCommand implements Command {
  readonly label = 'Connect ports';
  constructor(private readonly cable: RackCable) {}
  apply(s: ModelState) {
    s.rackCables.set(this.cable.id, this.cable);
  }
  undo(s: ModelState) {
    s.rackCables.delete(this.cable.id);
  }
}

export class UpdateRackCableCommand implements Command {
  readonly label = 'Edit cable';
  constructor(
    private readonly id: string,
    private readonly before: Partial<RackCable>,
    private readonly after: Partial<RackCable>,
  ) {}
  apply(s: ModelState) {
    const c = s.rackCables.get(this.id);
    if (c) s.rackCables.set(this.id, { ...c, ...this.after });
  }
  undo(s: ModelState) {
    const c = s.rackCables.get(this.id);
    if (c) s.rackCables.set(this.id, { ...c, ...this.before });
  }
  mergeWith(next: Command): Command | null {
    if (
      next instanceof UpdateRackCableCommand &&
      next.id === this.id &&
      sameKeys(this.after, next.after)
    ) {
      return new UpdateRackCableCommand(this.id, this.before, next.after);
    }
    return null;
  }
}

export class DeleteRackCableCommand implements Command {
  readonly label = 'Remove cable';
  private removed?: RackCable;
  constructor(private readonly id: string) {}
  apply(s: ModelState) {
    this.removed = s.rackCables.get(this.id);
    s.rackCables.delete(this.id);
  }
  undo(s: ModelState) {
    if (this.removed) s.rackCables.set(this.id, this.removed);
  }
}

export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private readonly commands: Command[],
  ) {}
  apply(s: ModelState) {
    for (const c of this.commands) c.apply(s);
  }
  undo(s: ModelState) {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]!.undo(s);
  }
}

/** Build a single atomic history entry from sub-commands. */
export function transaction(label: string, commands: Command[]): Command {
  return new CompositeCommand(label, commands);
}

function isDevice(d: Device | undefined): d is Device {
  return d !== undefined;
}
function isLink(l: Link | undefined): l is Link {
  return l !== undefined;
}
function isObject(o: CanvasObject | undefined): o is CanvasObject {
  return o !== undefined;
}
function sameKeys(a: object, b: object): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}
