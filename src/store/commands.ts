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
import type { CanvasObject, Device, Link } from '@/model/types';
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
    for (const link of this.removedLinks) removeLink(s, link.id);
    for (const device of this.removedDevices) removeDevice(s, device.id);
    for (const obj of this.removedObjects) s.objects.delete(obj.id);
  }
  undo(s: ModelState) {
    for (const device of this.removedDevices) addDevice(s, device);
    for (const link of this.removedLinks) addLink(s, link);
    for (const obj of this.removedObjects) s.objects.set(obj.id, obj);
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
    if (next instanceof UpdateObjectCommand && next.id === this.id && sameKeys(this.after, next.after)) {
      return new UpdateObjectCommand(this.id, this.before, next.after);
    }
    return null;
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
