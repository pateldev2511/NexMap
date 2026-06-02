/**
 * The mutable, normalized in-memory model (eng review DA-D2).
 *
 * Devices and links are keyed by ID for O(1) lookup, with a device→links
 * adjacency index so "what connects to X" and cascade-delete are O(degree), not
 * O(all links). Commands mutate this structure; the file format stays array-based.
 *
 * All mutation flows through these helpers so the adjacency index can never drift
 * out of sync with the device/link maps.
 */
import { createEmptyDocument } from '@/model/schema';
import type { Device, Layer, Link, NexMapDocument, ProjectMeta } from '@/model/types';

export interface ModelState {
  project: ProjectMeta;
  layers: Map<string, Layer>;
  devices: Map<string, Device>;
  links: Map<string, Link>;
  /** deviceId → set of link IDs touching it. */
  adjacency: Map<string, Set<string>>;
}

export function emptyModel(now: string): ModelState {
  return fromDocument(createEmptyDocument(now));
}

export function fromDocument(doc: NexMapDocument): ModelState {
  const state: ModelState = {
    project: doc.project,
    layers: new Map(doc.layers.map((l) => [l.id, l])),
    devices: new Map(),
    links: new Map(),
    adjacency: new Map(),
  };
  for (const d of doc.devices) addDevice(state, d);
  for (const l of doc.links) addLink(state, l);
  return state;
}

export function toDocument(state: ModelState, base: NexMapDocument): NexMapDocument {
  // Preserve the base document's forward-declared/unknown collections (DA-D1).
  return {
    ...base,
    project: state.project,
    layers: [...state.layers.values()].sort((a, b) => a.order - b.order),
    devices: [...state.devices.values()],
    links: [...state.links.values()],
  };
}

export function addDevice(state: ModelState, device: Device): void {
  state.devices.set(device.id, device);
  if (!state.adjacency.has(device.id)) state.adjacency.set(device.id, new Set());
}

export function removeDevice(state: ModelState, id: string): void {
  state.devices.delete(id);
  state.adjacency.delete(id);
}

export function addLink(state: ModelState, link: Link): void {
  state.links.set(link.id, link);
  if (link.sourceId) state.adjacency.get(link.sourceId)?.add(link.id);
  if (link.targetId) state.adjacency.get(link.targetId)?.add(link.id);
}

export function removeLink(state: ModelState, id: string): void {
  const link = state.links.get(id);
  if (!link) return;
  state.adjacency.get(link.sourceId)?.delete(id);
  state.adjacency.get(link.targetId)?.delete(id);
  state.links.delete(id);
}

/** Link IDs touching a device (its incident edges). */
export function linksForDevice(state: ModelState, deviceId: string): string[] {
  return [...(state.adjacency.get(deviceId) ?? [])];
}
