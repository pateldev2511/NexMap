/**
 * The project store: the single source of truth and the SINGLE WRITER to the
 * model (eng review DA-A2). UI dispatches semantic actions; the store turns them
 * into commands and runs them through History. Nothing else mutates ModelState.
 *
 * It also owns the SpatialIndex (DA-P2) and exposes a `SceneSource`-style read API
 * (`visibleDevices`/`visibleLinks`/`hitTest`) so the canvas renderer can stay
 * decoupled — it reads through these, never `event.target`, never Zustand maps
 * directly. `rev` increments on every change for cheap subscription.
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Device, DeviceType, Link, NexMapDocument, ValidationIssue } from '@/model/types';
import { createDevice, createEmptyDocument, createLink } from '@/model/schema';
import { validate, resetIssueIds } from '@/model/validate';
import { SpatialIndex, type Box } from '@/lib/spatial-index';
import { History } from './history';
import {
  AddDeviceCommand,
  AddLinkCommand,
  DeleteCommand,
  MoveDeviceCommand,
  UpdateDeviceCommand,
  type Command,
} from './commands';
import {
  emptyModel,
  fromDocument,
  toDocument,
  type ModelState,
} from './modelState';

// Module-private mutable internals. Kept outside React state so command mutation
// and index maintenance don't trigger structural-sharing overhead at scale.
let model: ModelState = emptyModel('1970-01-01T00:00:00.000Z');
let baseDoc: NexMapDocument = createEmptyDocument('1970-01-01T00:00:00.000Z');
const history = new History();
const index = new SpatialIndex();

function deviceBox(d: Device): Box {
  return { x: d.x, y: d.y, width: d.width, height: d.height };
}

function rebuildIndex(): void {
  index.clear();
  for (const d of model.devices.values()) index.insert(d.id, deviceBox(d));
}

export interface ProjectStore {
  /** Bumps on every model change — subscribe to trigger renders. */
  rev: number;
  selection: Set<string>;
  issues: ValidationIssue[];
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;

  // --- actions (the only writers) ---
  addDeviceAt(type: DeviceType, x: number, y: number): string;
  moveDevice(id: string, from: { x: number; y: number }, to: { x: number; y: number }): void;
  endDrag(): void;
  connect(sourceId: string, targetId: string): string | null;
  updateDevice(id: string, before: Partial<Device>, after: Partial<Device>): void;
  deleteSelection(): void;
  select(ids: string[], additive?: boolean): void;
  clearSelection(): void;
  undo(): void;
  redo(): void;
  runValidation(): void;
  loadDoc(doc: NexMapDocument): void;
  getDocument(): NexMapDocument;
  newProject(now: string): void;

  // --- SceneSource read API (renderer reads through these) ---
  visibleDevices(viewport: Box): Device[];
  visibleLinks(viewport: Box): Link[];
  getDevice(id: string): Device | undefined;
  hitTest(x: number, y: number): string[];
}

export const useProjectStore = create<ProjectStore>((set, get) => {
  function firstLayerId(): string {
    return model.layers.keys().next().value ?? 'default';
  }

  function commit(command: Command, opts: { reindex?: boolean } = {}): void {
    history.dispatch(command, model);
    if (opts.reindex) rebuildIndex();
    set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
  }

  return {
    rev: 0,
    selection: new Set<string>(),
    issues: [],
    canUndo: false,
    canRedo: false,
    dirty: false,

    addDeviceAt(type, x, y) {
      const device = createDevice(type, x, y, firstLayerId());
      history.dispatch(new AddDeviceCommand(device), model);
      index.insert(device.id, deviceBox(device));
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return device.id;
    },

    moveDevice(id, from, to) {
      history.dispatch(new MoveDeviceCommand(id, from, to), model);
      const d = model.devices.get(id);
      if (d) index.update(id, deviceBox(d));
      set({ rev: get().rev + 1, dirty: true });
    },

    endDrag() {
      history.commitCoalesceBoundary();
      set({ canUndo: history.canUndo, canRedo: history.canRedo });
    },

    connect(sourceId, targetId) {
      if (sourceId === targetId) return null;
      if (!model.devices.has(sourceId) || !model.devices.has(targetId)) return null;
      const link = createLink(sourceId, targetId, firstLayerId());
      commit(new AddLinkCommand(link));
      history.commitCoalesceBoundary();
      return link.id;
    },

    updateDevice(id, before, after) {
      commit(new UpdateDeviceCommand(id, before, after));
    },

    deleteSelection() {
      const ids = [...get().selection];
      if (ids.length === 0) return;
      const deviceIds = ids.filter((id) => model.devices.has(id));
      const linkIds = ids.filter((id) => model.links.has(id));
      commit(new DeleteCommand(deviceIds, linkIds), { reindex: true });
      history.commitCoalesceBoundary();
      set({ selection: new Set() });
    },

    select(ids, additive = false) {
      const next = additive ? new Set(get().selection) : new Set<string>();
      for (const id of ids) next.add(id);
      set({ selection: next });
    },

    clearSelection() {
      set({ selection: new Set() });
    },

    undo() {
      if (history.undo(model)) {
        rebuildIndex();
        set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      }
    },

    redo() {
      if (history.redo(model)) {
        rebuildIndex();
        set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      }
    },

    runValidation() {
      resetIssueIds();
      const issues = validate({
        devices: [...model.devices.values()],
        links: [...model.links.values()],
      });
      set({ issues });
    },

    loadDoc(doc) {
      model = fromDocument(doc);
      baseDoc = doc;
      history.clear();
      rebuildIndex();
      resetIssueIds();
      set({
        rev: get().rev + 1,
        selection: new Set(),
        issues: validate({
          devices: [...model.devices.values()],
          links: [...model.links.values()],
        }),
        canUndo: false,
        canRedo: false,
        dirty: false,
      });
    },

    getDocument() {
      return toDocument(model, baseDoc);
    },

    newProject(now) {
      const doc = createEmptyDocument(now);
      get().loadDoc(doc);
      set({ dirty: false });
    },

    visibleDevices(viewport) {
      const ids = index.query(viewport);
      const out: Device[] = [];
      for (const id of ids) {
        const d = model.devices.get(id);
        if (d) out.push(d);
      }
      return out;
    },

    visibleLinks(viewport) {
      // A link is visible if either endpoint is in (or near) the viewport.
      const visible = new Set(index.query(viewport));
      const out: Link[] = [];
      for (const l of model.links.values()) {
        if (visible.has(l.sourceId) || visible.has(l.targetId)) out.push(l);
      }
      return out;
    },

    getDevice(id) {
      return model.devices.get(id);
    },

    hitTest(x, y) {
      return index.hit(x, y);
    },
  };
});

/** Test-only escape hatch to inspect internal model size. */
export function __debugModelSize(): { devices: number; links: number; indexed: number } {
  return { devices: model.devices.size, links: model.links.size, indexed: index.size };
}

/** Generate a stable id (re-exported so UI code doesn't import nanoid directly). */
export function newId(): string {
  return nanoid();
}
