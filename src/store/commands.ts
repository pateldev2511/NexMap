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
import type { Device, Link } from '@/model/types';
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

/**
 * Delete devices (and cascade their incident links) atomically. Captures the full
 * removed set at apply-time so undo restores devices AND links exactly (DA-E6).
 */
export class DeleteCommand implements Command {
  readonly label = 'Delete';
  private removedDevices: Device[] = [];
  private removedLinks: Link[] = [];
  constructor(
    private readonly deviceIds: string[],
    private readonly explicitLinkIds: string[] = [],
  ) {}
  apply(s: ModelState) {
    // Recompute the removed set on (re-)apply so redo after edits stays correct.
    const linkIds = new Set(this.explicitLinkIds);
    for (const id of this.deviceIds) {
      for (const lid of linksForDevice(s, id)) linkIds.add(lid);
    }
    this.removedLinks = [...linkIds].map((id) => s.links.get(id)).filter(isLink);
    this.removedDevices = this.deviceIds.map((id) => s.devices.get(id)).filter(isDevice);
    for (const link of this.removedLinks) removeLink(s, link.id);
    for (const device of this.removedDevices) removeDevice(s, device.id);
  }
  undo(s: ModelState) {
    for (const device of this.removedDevices) addDevice(s, device);
    for (const link of this.removedLinks) addLink(s, link);
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
function sameKeys(a: object, b: object): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}
