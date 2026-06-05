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
import type {
  CanvasObject,
  Device,
  DeviceType,
  Link,
  Layer,
  NexMapDocument,
  Rack,
  Subnet,
  ValidationIssue,
  View,
  Vlan,
} from '@/model/types';
import {
  createDevice,
  createEmptyDocument,
  createLink,
  createImageObject,
  createLayer,
  createRack,
  createShapeObject,
  createSubnet,
  createTextObject,
  createView,
  createVlan,
} from '@/model/schema';
import { validate, resetIssueIds } from '@/model/validate';
import { SpatialIndex, type Box } from '@/lib/spatial-index';
import { computeAlignSnap, type AlignGuide } from '@/canvas/align';
import { autoLayoutPositions } from '@/lib/layout';
import { pointInPolygon, type Point } from '@/lib/geometry';
import { History } from './history';
import {
  AddDeviceCommand,
  AddLayerCommand,
  AddLinkCommand,
  AddObjectCommand,
  AddRackCommand,
  AddSubnetCommand,
  AddVlanCommand,
  DeleteCommand,
  DeleteLayerCommand,
  DeleteRackCommand,
  DeleteSubnetCommand,
  DeleteVlanCommand,
  MoveDeviceCommand,
  MoveObjectCommand,
  RenameProjectCommand,
  UpdateDeviceCommand,
  UpdateLayerCommand,
  UpdateLinkCommand,
  UpdateObjectCommand,
  UpdateRackCommand,
  UpdateSubnetCommand,
  UpdateVlanCommand,
  transaction,
  type Command,
} from './commands';

export type CanvasMode = 'select' | 'pan' | 'connect' | 'lasso' | 'text' | 'shape';
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type Projection = 'flat' | 'iso';
import { emptyModel, fromDocument, toDocument, type ModelState } from './modelState';

// Module-private mutable internals. Kept outside React state so command mutation
// and index maintenance don't trigger structural-sharing overhead at scale.
let model: ModelState = emptyModel('1970-01-01T00:00:00.000Z');
let baseDoc: NexMapDocument = createEmptyDocument('1970-01-01T00:00:00.000Z');
const history = new History();
const index = new SpatialIndex();
/** Origin positions captured at drag start (transient, not in history). */
let dragOrigins: Map<string, { x: number; y: number }> | null = null;
/** Alignment guide lines for the in-flight drag/resize (transient). */
let alignGuides: AlignGuide[] = [];
/** Original box captured at resize start (transient, not in history). */
let resizeOrig: { id: string; box: Box } | null = null;
/** Clipboard of copied model snapshots. Module-scoped, session-only. */
let clipboard: Array<Device | CanvasObject> = [];
let pasteOffset = 0;
/** Latest canvas camera, reported by the renderer (module-scoped to avoid re-render loops). */
let currentCamera = { tx: 0, ty: 0, scale: 1 };
/** Camera the canvas should jump to (set by applyView, read on cameraTick). */
let pendingCamera: { tx: number; ty: number; scale: number } | null = null;
/** A saved view applies temporary visibility without mutating saved layer state. */
let activeViewHiddenLayers: Set<string> | null = null;

function deviceBox(d: Device): Box {
  return { x: d.x, y: d.y, width: d.width, height: d.height };
}
function objBox(o: CanvasObject): Box {
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}
/** Any movable entity (device or object). */
function movable(id: string): (Device | CanvasObject) | undefined {
  return model.devices.get(id) ?? model.objects.get(id);
}

function cloneMovable(
  item: Device | CanvasObject,
  x: number,
  y: number,
  layerId: string,
): Device | CanvasObject {
  if (item.kind === 'device') {
    return createDevice(item.type, x, y, layerId, {
      name: item.name,
      vendor: item.vendor,
      model: item.model,
      role: item.role,
      location: item.location,
      managementIp: undefined,
      notes: item.notes,
      fill: item.fill,
      rackId: item.rackId,
      ru: item.ru,
      ruSpan: item.ruSpan,
      z: item.z,
      groupId: item.groupId,
      extra: item.extra ? { ...item.extra } : undefined,
    });
  }
  if (item.kind === 'text') {
    return createTextObject(x, y, layerId, {
      width: item.width,
      height: item.height,
      text: item.text,
      fontSize: item.fontSize,
      color: item.color,
      z: item.z,
      groupId: item.groupId,
      extra: item.extra ? { ...item.extra } : undefined,
    });
  }
  if (item.kind === 'shape') {
    return createShapeObject(x, y, item.width, item.height, layerId, {
      shape: item.shape,
      label: item.label,
      fill: item.fill,
      stroke: item.stroke,
      z: item.z,
      groupId: item.groupId,
      extra: item.extra ? { ...item.extra } : undefined,
    });
  }
  return createImageObject(x, y, item.width, item.height, layerId, item.href, {
    opacity: item.opacity,
    z: item.z,
    groupId: item.groupId,
    extra: item.extra ? { ...item.extra } : undefined,
  });
}

function remapCloneGroups<T extends Device | CanvasObject>(clones: T[]): T[] {
  const counts = new Map<string, number>();
  for (const c of clones) {
    if (c.groupId) counts.set(c.groupId, (counts.get(c.groupId) ?? 0) + 1);
  }
  const replacements = new Map<string, string>();
  return clones.map((c) => {
    if (!c.groupId) return c;
    if ((counts.get(c.groupId) ?? 0) < 2) return { ...c, groupId: undefined };
    if (!replacements.has(c.groupId)) replacements.set(c.groupId, nanoid());
    return { ...c, groupId: replacements.get(c.groupId) };
  });
}

function rebuildIndex(): void {
  index.clear();
  for (const d of model.devices.values()) index.insert(d.id, deviceBox(d));
  for (const o of model.objects.values()) index.insert(o.id, objBox(o));
}

/** Shared z-order transaction: compute new z per selected movable entity, commit as one entry. */
function applyZ(
  get: () => ProjectStore,
  set: (partial: Partial<ProjectStore>) => void,
  hist: History,
  mdl: ModelState,
  compute: (
    sel: Array<Device | CanvasObject>,
    allZ: number[],
  ) => { id: string; z: number }[],
): void {
  const sel = [...get().selection]
    .map((id) => mdl.devices.get(id) ?? mdl.objects.get(id))
    .filter((m): m is Device | CanvasObject => m !== undefined);
  if (sel.length === 0) return;
  const allZ = [...mdl.devices.values(), ...mdl.objects.values()].map((m) => m.z ?? 0);
  const cmds = compute(sel, allZ).map((u) =>
    mdl.devices.has(u.id)
      ? new UpdateDeviceCommand(u.id, { z: mdl.devices.get(u.id)!.z }, { z: u.z })
      : new UpdateObjectCommand(u.id, { z: mdl.objects.get(u.id)!.z }, { z: u.z }),
  );
  hist.dispatch(transaction('Reorder', cmds), mdl);
  hist.commitCoalesceBoundary();
  set({ rev: get().rev + 1, canUndo: hist.canUndo, canRedo: hist.canRedo, dirty: true });
}

export interface ProjectStore {
  /** Bumps on every model change — subscribe to trigger renders. */
  rev: number;
  selection: Set<string>;
  issues: ValidationIssue[];
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  mode: CanvasMode;
  /** Active render projection (flat or isometric). View-level, not undoable. */
  projection: Projection;
  projectName: string;
  activeLayerId: string;
  activeViewId: string | null;
  /** Bumped to ask the canvas to restore the pending camera. */
  cameraTick: number;
  /** Bumped to ask the canvas to center on `focusTarget` (jump-to-object). */
  focusTarget: string | null;
  focusTick: number;

  // --- actions (the only writers) ---
  addDeviceAt(type: DeviceType, x: number, y: number): string;
  addText(x: number, y: number): string;
  addShape(x: number, y: number, width: number, height: number): string;
  addImage(href: string, width: number, height: number): string;
  updateObject(
    id: string,
    before: Partial<CanvasObject>,
    after: Partial<CanvasObject>,
  ): void;
  getObject(id: string): CanvasObject | undefined;
  objectsAll(): CanvasObject[];
  /** Begin dragging the current selection — snapshots origin positions. */
  beginDrag(): void;
  /** Move dragged devices by a canvas-space delta (transient, no history). */
  dragTo(dx: number, dy: number, suspendSnap: boolean, scale?: number): void;
  /** Commit the drag as a single undoable entry (no-op if nothing moved). */
  endDrag(): void;
  /** Alignment guide lines for the in-flight drag (read during render). */
  alignGuides(): AlignGuide[];
  /** Begin resizing a single object — snapshots its box (transient). */
  beginResize(id: string): void;
  /** Apply a transient resize box (no history). */
  resizeTo(box: { x: number; y: number; width: number; height: number }): void;
  /** Commit the resize as a single undoable entry (no-op if unchanged). */
  endResize(): void;
  connect(sourceId: string, targetId: string): string | null;
  /** Apply imported devices+links as ONE atomic, undoable transaction (DA-T2). */
  importObjects(devices: Device[], links: Link[]): void;
  /** Apply imported VLANs/subnets as one atomic, undoable transaction. */
  importSemantics(subnets: Subnet[], vlans: Vlan[]): void;
  /** Layer id new imported/created objects attach to (the active layer). */
  defaultLayerId(): string;
  // Layer management (Phase 5). Layer config is document state and undoable.
  layersAll(): Layer[];
  setActiveLayer(id: string): void;
  addLayer(): string;
  renameLayer(id: string, name: string): void;
  deleteLayer(id: string): void;
  setLayerVisible(id: string, visible: boolean): void;
  setLayerLocked(id: string, locked: boolean): void;
  moveLayer(id: string, dir: -1 | 1): void;
  isLayerVisible(id: string): boolean;
  isLayerLocked(id: string): boolean;
  // Multi-view (Phase 5).
  viewsAll(): View[];
  /** Renderer reports its camera so views can capture it. */
  reportCamera(c: { tx: number; ty: number; scale: number }): void;
  /** Camera the canvas should restore (consumed on cameraTick). */
  cameraRequest(): { tx: number; ty: number; scale: number } | null;
  /** Save the current layer-visibility + camera as a named view. */
  addView(name: string): string;
  renameView(id: string, name: string): void;
  deleteView(id: string): void;
  /** Apply a view: temporary layer visibility + request its camera. */
  applyView(id: string): void;
  updateDevice(id: string, before: Partial<Device>, after: Partial<Device>): void;
  updateLink(id: string, before: Partial<Link>, after: Partial<Link>): void;
  renameProject(before: string, after: string): void;
  setMode(mode: CanvasMode): void;
  /** Switch the active render projection (flat ↔ isometric). */
  setProjection(p: Projection): void;
  endEdit(): void;
  /** Mark the model as saved to a file (clears the unsaved-changes dot). */
  markSaved(): void;
  deleteSelection(): void;
  select(ids: string[], additive?: boolean): void;
  boxSelect(box: Box, additive?: boolean): void;
  /** Select devices whose center falls inside a freehand polygon (lasso). */
  lassoSelect(points: Point[], additive?: boolean): void;
  selectAll(): void;
  clearSelection(): void;
  /** Duplicate selected devices (offset, new IDs) as one undoable entry. */
  duplicateSelection(): void;
  copySelection(): void;
  cutSelection(): void;
  paste(): void;
  hasClipboard(): boolean;
  /** Toggle locked on selected devices (one undoable entry). */
  toggleLockSelection(): void;
  /** Move unlocked selected devices by a delta as one undoable entry. */
  nudgeSelection(dx: number, dy: number): void;
  /** Align selected entities to a shared edge/center (one undoable entry). */
  alignSelection(edge: AlignEdge): void;
  /** Evenly distribute 3+ selected entities along an axis (one undoable entry). */
  distributeSelection(axis: 'h' | 'v'): void;
  /** Arrange all unlocked devices into a tidy layered layout (one undoable entry). */
  autoLayout(): void;
  /** Group selected devices so they select/move together. */
  groupSelection(): void;
  /** Clear the group of selected devices. */
  ungroupSelection(): void;
  /** All device IDs in the same group as `id` (or just `id` if ungrouped). */
  groupMembers(id: string): string[];
  /** Z-order operations on the current selection. */
  bringToFront(): void;
  sendToBack(): void;
  bringForward(): void;
  sendBackward(): void;
  /** Select an object and ask the canvas to center on it (jump-to-object). */
  focusObject(id: string): void;
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
  getLink(id: string): Link | undefined;
  devicesAll(): Device[];
  linksAll(): Link[];
  // VLAN / subnet semantics (Phase 4).
  addVlan(vlanId: number, name: string): string;
  updateVlan(id: string, before: Partial<Vlan>, after: Partial<Vlan>): void;
  deleteVlan(id: string): void;
  vlansAll(): Vlan[];
  addSubnet(cidr: string): string;
  updateSubnet(id: string, before: Partial<Subnet>, after: Partial<Subnet>): void;
  deleteSubnet(id: string): void;
  subnetsAll(): Subnet[];
  addRack(name: string): string;
  updateRack(id: string, before: Partial<Rack>, after: Partial<Rack>): void;
  deleteRack(id: string): void;
  racksAll(): Rack[];
  hitTest(x: number, y: number): string[];
  queryBox(box: Box): string[];
  contentBounds(): Box;
}

const GRID = 16;
function snapValue(v: number, suspend: boolean): number {
  return suspend ? v : Math.round(v / GRID) * GRID;
}

export const useProjectStore = create<ProjectStore>((set, get) => {
  // New objects/devices/links attach to the active layer (falling back to the first).
  function firstLayerId(): string {
    const active = get()?.activeLayerId; // get() is undefined during store init
    if (active && model.layers.has(active)) return active;
    return model.layers.keys().next().value ?? 'default';
  }

  function commit(command: Command, opts: { reindex?: boolean } = {}): void {
    history.dispatch(command, model);
    if (opts.reindex) rebuildIndex();
    set({
      rev: get().rev + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      dirty: true,
    });
  }

  return {
    rev: 0,
    selection: new Set<string>(),
    issues: [],
    canUndo: false,
    canRedo: false,
    dirty: false,
    mode: 'select',
    projection: 'flat',
    projectName: model.project.name,
    activeLayerId: firstLayerId(),
    activeViewId: null,
    cameraTick: 0,
    focusTarget: null,
    focusTick: 0,

    addDeviceAt(type, x, y) {
      const device = createDevice(type, x, y, firstLayerId());
      history.dispatch(new AddDeviceCommand(device), model);
      index.insert(device.id, deviceBox(device));
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
      return device.id;
    },

    addText(x, y) {
      const obj = createTextObject(x, y, firstLayerId());
      history.dispatch(new AddObjectCommand(obj), model);
      index.insert(obj.id, objBox(obj));
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        selection: new Set([obj.id]),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
      return obj.id;
    },

    addShape(x, y, width, height) {
      const obj = createShapeObject(x, y, width, height, firstLayerId(), {
        label: 'Zone',
      });
      history.dispatch(new AddObjectCommand(obj), model);
      index.insert(obj.id, objBox(obj));
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        selection: new Set([obj.id]),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
      return obj.id;
    },

    addImage(href, width, height) {
      // Cap absurd dimensions; underlays render at the back via z=-1000.
      const w = Math.min(width, 4000);
      const h = Math.min(height, 4000);
      const obj = createImageObject(40, 40, w, h, firstLayerId(), href);
      history.dispatch(new AddObjectCommand(obj), model);
      index.insert(obj.id, objBox(obj));
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        selection: new Set([obj.id]),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
      return obj.id;
    },

    updateObject(id, before, after) {
      commit(new UpdateObjectCommand(id, before, after));
    },

    getObject(id) {
      return model.objects.get(id);
    },

    objectsAll() {
      return [...model.objects.values()];
    },

    beginDrag() {
      const origins = new Map<string, { x: number; y: number }>();
      for (const id of get().selection) {
        const m = movable(id);
        // Locked entities and entities on a locked layer don't move.
        if (m && !m.locked && !model.layers.get(m.layerId)?.locked) {
          origins.set(id, { x: m.x, y: m.y });
        }
      }
      dragOrigins = origins;
    },

    dragTo(dx, dy, suspendSnap, scale = 1) {
      if (!dragOrigins) return;

      // Alignment snapping: nudge the whole selection so its closest edge/center
      // lands on a nearby static object's edge/center. Skipped when snap is
      // suspended (Alt). Falls back to grid snap on any axis that didn't align.
      let adjX: number | null = null;
      let adjY: number | null = null;
      alignGuides = [];
      if (!suspendSnap && dragOrigins.size > 0) {
        // Proposed (unsnapped) bounding box of the dragged selection.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [id, origin] of dragOrigins) {
          const m = movable(id);
          if (!m) continue;
          const x = origin.x + dx;
          const y = origin.y + dy;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + m.width);
          maxY = Math.max(maxY, y + m.height);
        }
        if (Number.isFinite(minX)) {
          const moving = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          const threshold = 6 / scale; // ~6 screen px regardless of zoom
          const margin = threshold + 8;
          const near = index.query({
            x: moving.x - margin,
            y: moving.y - margin,
            width: moving.width + margin * 2,
            height: moving.height + margin * 2,
          });
          const statics: Box[] = [];
          for (const id of near) {
            if (dragOrigins.has(id)) continue;
            const m = movable(id);
            if (m) statics.push({ x: m.x, y: m.y, width: m.width, height: m.height });
          }
          const snap = computeAlignSnap(moving, statics, threshold);
          adjX = snap.adjX;
          adjY = snap.adjY;
          alignGuides = snap.guides;
        }
      }

      for (const [id, origin] of dragOrigins) {
        const x =
          adjX !== null ? origin.x + dx + adjX : snapValue(origin.x + dx, suspendSnap);
        const y =
          adjY !== null ? origin.y + dy + adjY : snapValue(origin.y + dy, suspendSnap);
        const d = model.devices.get(id);
        if (d) {
          model.devices.set(id, { ...d, x, y });
          index.update(id, { x, y, width: d.width, height: d.height });
          continue;
        }
        const o = model.objects.get(id);
        if (o) {
          model.objects.set(id, { ...o, x, y });
          index.update(id, { x, y, width: o.width, height: o.height });
        }
      }
      set({ rev: get().rev + 1, dirty: true });
    },

    alignGuides() {
      return alignGuides;
    },

    beginResize(id) {
      const o = model.objects.get(id);
      if (!o || o.locked || model.layers.get(o.layerId)?.locked) {
        resizeOrig = null;
        return;
      }
      resizeOrig = { id, box: { x: o.x, y: o.y, width: o.width, height: o.height } };
    },

    resizeTo(box) {
      if (!resizeOrig) return;
      const o = model.objects.get(resizeOrig.id);
      if (!o) return;
      model.objects.set(o.id, { ...o, ...box });
      index.update(o.id, box);
      set({ rev: get().rev + 1, dirty: true });
    },

    endResize() {
      if (!resizeOrig) return;
      const orig = resizeOrig.box;
      const o = model.objects.get(resizeOrig.id);
      resizeOrig = null;
      if (!o) return;
      const cur = { x: o.x, y: o.y, width: o.width, height: o.height };
      if (
        cur.x === orig.x &&
        cur.y === orig.y &&
        cur.width === orig.width &&
        cur.height === orig.height
      ) {
        return; // nothing changed
      }
      // Model already holds `cur`; record before=orig, after=cur for undo.
      history.dispatch(new UpdateObjectCommand(o.id, orig, cur), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    endDrag() {
      alignGuides = [];
      if (!dragOrigins) return;
      // Commit the net move of each entity as ONE atomic history entry.
      const moves: Command[] = [];
      for (const [id, origin] of dragOrigins) {
        const m = movable(id);
        if (!m) continue;
        if (m.x !== origin.x || m.y !== origin.y) {
          moves.push(
            model.devices.has(id)
              ? new MoveDeviceCommand(id, origin, { x: m.x, y: m.y })
              : new MoveObjectCommand(id, origin, { x: m.x, y: m.y }),
          );
        }
      }
      dragOrigins = null;
      if (moves.length === 0) return;
      // Already applied during dragTo; record without disturbing positions.
      history.dispatch(transaction('Move', moves), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    connect(sourceId, targetId) {
      if (sourceId === targetId) return null;
      if (!model.devices.has(sourceId) || !model.devices.has(targetId)) return null;
      const link = createLink(sourceId, targetId, firstLayerId());
      commit(new AddLinkCommand(link));
      history.commitCoalesceBoundary();
      return link.id;
    },

    importObjects(devices, links) {
      if (devices.length === 0 && links.length === 0) return;
      const cmds: Command[] = [
        ...devices.map((d) => new AddDeviceCommand(d)),
        ...links.map((l) => new AddLinkCommand(l)),
      ];
      history.dispatch(
        transaction(`Import ${devices.length + links.length} objects`, cmds),
        model,
      );
      for (const d of devices) index.insert(d.id, deviceBox(d));
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    importSemantics(subnets, vlans) {
      if (subnets.length === 0 && vlans.length === 0) return;
      const cmds: Command[] = [
        ...subnets.map((s) => new AddSubnetCommand(s)),
        ...vlans.map((v) => new AddVlanCommand(v)),
      ];
      history.dispatch(transaction(`Import ${cmds.length} entries`, cmds), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    defaultLayerId() {
      const active = get().activeLayerId;
      return model.layers.has(active) ? active : firstLayerId();
    },

    layersAll() {
      return [...model.layers.values()].sort((a, b) => a.order - b.order);
    },

    setActiveLayer(id) {
      if (model.layers.has(id)) set({ activeLayerId: id });
    },

    addLayer() {
      const order = Math.max(-1, ...[...model.layers.values()].map((l) => l.order)) + 1;
      const layer = createLayer(`Layer ${model.layers.size + 1}`, order);
      activeViewHiddenLayers = null;
      commit(new AddLayerCommand(layer));
      history.commitCoalesceBoundary();
      set({ activeLayerId: layer.id, activeViewId: null });
      return layer.id;
    },

    renameLayer(id, name) {
      const l = model.layers.get(id);
      if (l) {
        activeViewHiddenLayers = null;
        commit(new UpdateLayerCommand(id, { name: l.name }, { name }));
        set({ activeViewId: null });
      }
    },

    deleteLayer(id) {
      if (model.layers.size <= 1) return; // keep at least one layer
      const fallback = [...model.layers.keys()].find((k) => k !== id)!;
      activeViewHiddenLayers = null;
      commit(new DeleteLayerCommand(id, fallback));
      history.commitCoalesceBoundary();
      const active = get().activeLayerId === id ? fallback : get().activeLayerId;
      set({ activeLayerId: active, activeViewId: null });
    },

    setLayerVisible(id, visible) {
      const l = model.layers.get(id);
      if (l) {
        activeViewHiddenLayers = null;
        commit(new UpdateLayerCommand(id, { visible: l.visible }, { visible }));
        history.commitCoalesceBoundary();
        set({ activeViewId: null });
      }
    },

    setLayerLocked(id, locked) {
      const l = model.layers.get(id);
      if (l) {
        activeViewHiddenLayers = null;
        commit(new UpdateLayerCommand(id, { locked: l.locked }, { locked }));
        history.commitCoalesceBoundary();
        set({ activeViewId: null });
      }
    },

    moveLayer(id, dir) {
      const sorted = [...model.layers.values()].sort((a, b) => a.order - b.order);
      const i = sorted.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return;
      const a = sorted[i]!;
      const b = sorted[j]!;
      activeViewHiddenLayers = null;
      history.dispatch(
        transaction('Reorder layers', [
          new UpdateLayerCommand(a.id, { order: a.order }, { order: b.order }),
          new UpdateLayerCommand(b.id, { order: b.order }, { order: a.order }),
        ]),
        model,
      );
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
        activeViewId: null,
      });
    },

    isLayerVisible(id) {
      if (activeViewHiddenLayers) return !activeViewHiddenLayers.has(id);
      return model.layers.get(id)?.visible ?? true;
    },

    isLayerLocked(id) {
      return model.layers.get(id)?.locked ?? false;
    },

    viewsAll() {
      return [...model.views.values()];
    },

    reportCamera(c) {
      currentCamera = c;
    },

    cameraRequest() {
      return pendingCamera;
    },

    addView(name) {
      const hiddenLayers = [...model.layers.values()]
        .filter((l) => !get().isLayerVisible(l.id))
        .map((l) => l.id);
      const view = createView(name, {
        hiddenLayers,
        camera: { ...currentCamera },
        projection: get().projection,
      });
      model.views.set(view.id, view);
      set({ rev: get().rev + 1, dirty: true, activeViewId: view.id });
      return view.id;
    },

    renameView(id, name) {
      const v = model.views.get(id);
      if (v) {
        model.views.set(id, { ...v, name });
        set({ rev: get().rev + 1, dirty: true });
      }
    },

    deleteView(id) {
      model.views.delete(id);
      set({
        rev: get().rev + 1,
        dirty: true,
        activeViewId: get().activeViewId === id ? null : get().activeViewId,
      });
    },

    applyView(id) {
      const v = model.views.get(id);
      if (!v) return;
      activeViewHiddenLayers = new Set(v.hiddenLayers);
      pendingCamera = v.camera ?? null;
      set({
        rev: get().rev + 1,
        activeViewId: id,
        projection: v.projection ?? 'flat',
        cameraTick: get().cameraTick + 1,
      });
    },

    copySelection() {
      const ids = [...get().selection].filter((id) => movable(id));
      clipboard = ids.map((id) => ({ ...movable(id)! }));
      pasteOffset = 0;
    },

    cutSelection() {
      get().copySelection();
      get().deleteSelection();
    },

    hasClipboard() {
      return clipboard.length > 0;
    },

    paste() {
      if (clipboard.length === 0) return;
      pasteOffset += 24;
      const clones = remapCloneGroups(
        clipboard.map((item) =>
          cloneMovable(item, item.x + pasteOffset, item.y + pasteOffset, firstLayerId()),
        ),
      );
      const cmds = clones.map((c) =>
        c.kind === 'device' ? new AddDeviceCommand(c) : new AddObjectCommand(c),
      );
      history.dispatch(transaction('Paste', cmds), model);
      for (const c of clones) {
        index.insert(c.id, c.kind === 'device' ? deviceBox(c) : objBox(c));
      }
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        selection: new Set(clones.map((c) => c.id)),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    toggleLockSelection() {
      const ids = [...get().selection].filter((id) => movable(id));
      if (ids.length === 0) return;
      // If any is unlocked, lock all; else unlock all.
      const anyUnlocked = ids.some((id) => !movable(id)!.locked);
      const cmds = ids.map((id) => {
        const cur = !!movable(id)!.locked;
        return model.devices.has(id)
          ? new UpdateDeviceCommand(id, { locked: cur }, { locked: anyUnlocked })
          : new UpdateObjectCommand(id, { locked: cur }, { locked: anyUnlocked });
      });
      history.dispatch(transaction(anyUnlocked ? 'Lock' : 'Unlock', cmds), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    nudgeSelection(dx, dy) {
      const ids = [...get().selection].filter((id) => {
        const m = movable(id);
        return m && !m.locked && !model.layers.get(m.layerId)?.locked;
      });
      if (ids.length === 0) return;
      const cmds = ids.map((id) => {
        const m = movable(id)!;
        return model.devices.has(id)
          ? new MoveDeviceCommand(id, { x: m.x, y: m.y }, { x: m.x + dx, y: m.y + dy })
          : new MoveObjectCommand(id, { x: m.x, y: m.y }, { x: m.x + dx, y: m.y + dy });
      });
      history.dispatch(transaction('Nudge', cmds), model);
      for (const id of ids) {
        const m = movable(id)!;
        index.update(id, { x: m.x, y: m.y, width: m.width, height: m.height });
      }
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    alignSelection(edge) {
      const items = [...get().selection]
        .map((id) => movable(id))
        .filter(
          (m): m is Device | CanvasObject =>
            !!m && !m.locked && !model.layers.get(m.layerId)?.locked,
        );
      if (items.length < 2) return;
      const minX = Math.min(...items.map((m) => m.x));
      const maxR = Math.max(...items.map((m) => m.x + m.width));
      const minY = Math.min(...items.map((m) => m.y));
      const maxB = Math.max(...items.map((m) => m.y + m.height));
      const cx = (minX + maxR) / 2;
      const cy = (minY + maxB) / 2;
      const target = (m: Device | CanvasObject): { x: number; y: number } => {
        switch (edge) {
          case 'left':
            return { x: minX, y: m.y };
          case 'right':
            return { x: maxR - m.width, y: m.y };
          case 'hcenter':
            return { x: Math.round(cx - m.width / 2), y: m.y };
          case 'top':
            return { x: m.x, y: minY };
          case 'bottom':
            return { x: m.x, y: maxB - m.height };
          case 'vcenter':
            return { x: m.x, y: Math.round(cy - m.height / 2) };
        }
      };
      const cmds: Command[] = [];
      for (const m of items) {
        const t = target(m);
        if (t.x === m.x && t.y === m.y) continue;
        cmds.push(
          model.devices.has(m.id)
            ? new MoveDeviceCommand(m.id, { x: m.x, y: m.y }, t)
            : new MoveObjectCommand(m.id, { x: m.x, y: m.y }, t),
        );
      }
      if (cmds.length === 0) return;
      history.dispatch(transaction('Align', cmds), model);
      rebuildIndex();
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    distributeSelection(axis) {
      const items = [...get().selection]
        .map((id) => movable(id))
        .filter(
          (m): m is Device | CanvasObject =>
            !!m && !m.locked && !model.layers.get(m.layerId)?.locked,
        );
      if (items.length < 3) return;
      const cen = (m: Device | CanvasObject) =>
        axis === 'h' ? m.x + m.width / 2 : m.y + m.height / 2;
      const sorted = [...items].sort((a, b) => cen(a) - cen(b));
      const first = cen(sorted[0]!);
      const last = cen(sorted[sorted.length - 1]!);
      const step = (last - first) / (sorted.length - 1);
      const cmds: Command[] = [];
      for (let i = 1; i < sorted.length - 1; i++) {
        const m = sorted[i]!;
        const targetCenter = first + step * i;
        const t =
          axis === 'h'
            ? { x: Math.round(targetCenter - m.width / 2), y: m.y }
            : { x: m.x, y: Math.round(targetCenter - m.height / 2) };
        if (t.x === m.x && t.y === m.y) continue;
        cmds.push(
          model.devices.has(m.id)
            ? new MoveDeviceCommand(m.id, { x: m.x, y: m.y }, t)
            : new MoveObjectCommand(m.id, { x: m.x, y: m.y }, t),
        );
      }
      if (cmds.length === 0) return;
      history.dispatch(transaction('Distribute', cmds), model);
      rebuildIndex();
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    autoLayout() {
      const ds = [...model.devices.values()];
      if (ds.length === 0) return;
      const pos = autoLayoutPositions(
        ds.map((d) => ({ id: d.id, width: d.width, height: d.height })),
        [...model.links.values()].map((l) => ({
          sourceId: l.sourceId,
          targetId: l.targetId,
        })),
      );
      const cmds: Command[] = [];
      for (const d of ds) {
        if (d.locked || model.layers.get(d.layerId)?.locked) continue;
        const p = pos.get(d.id);
        if (!p || (p.x === d.x && p.y === d.y)) continue;
        cmds.push(new MoveDeviceCommand(d.id, { x: d.x, y: d.y }, p));
      }
      if (cmds.length === 0) return;
      history.dispatch(transaction('Auto-layout', cmds), model);
      rebuildIndex();
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    groupSelection() {
      const ids = [...get().selection].filter((id) => movable(id));
      if (ids.length < 2) return;
      const gid = nanoid();
      const cmds = ids.map((id) =>
        model.devices.has(id)
          ? new UpdateDeviceCommand(
              id,
              { groupId: model.devices.get(id)!.groupId },
              { groupId: gid },
            )
          : new UpdateObjectCommand(
              id,
              { groupId: model.objects.get(id)!.groupId },
              { groupId: gid },
            ),
      );
      history.dispatch(transaction('Group', cmds), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    ungroupSelection() {
      const ids = [...get().selection].filter((id) => movable(id)?.groupId);
      if (ids.length === 0) return;
      const cmds = ids.map((id) =>
        model.devices.has(id)
          ? new UpdateDeviceCommand(
              id,
              { groupId: model.devices.get(id)!.groupId },
              { groupId: undefined },
            )
          : new UpdateObjectCommand(
              id,
              { groupId: model.objects.get(id)!.groupId },
              { groupId: undefined },
            ),
      );
      history.dispatch(transaction('Ungroup', cmds), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    groupMembers(id) {
      const gid = movable(id)?.groupId;
      if (!gid) return [id];
      const out: string[] = [];
      for (const d of model.devices.values()) if (d.groupId === gid) out.push(d.id);
      for (const o of model.objects.values()) if (o.groupId === gid) out.push(o.id);
      return out;
    },

    bringToFront() {
      applyZ(get, set, history, model, (sel, allZ) => {
        const top = Math.max(0, ...allZ) + 1;
        // Preserve relative order among the selected.
        return sel.map((d, i) => ({ id: d.id, z: top + i }));
      });
    },
    sendToBack() {
      applyZ(get, set, history, model, (sel, allZ) => {
        const bottom = Math.min(0, ...allZ) - sel.length;
        return sel.map((d, i) => ({ id: d.id, z: bottom + i }));
      });
    },
    bringForward() {
      applyZ(get, set, history, model, (sel) =>
        sel.map((d) => ({ id: d.id, z: (d.z ?? 0) + 1 })),
      );
    },
    sendBackward() {
      applyZ(get, set, history, model, (sel) =>
        sel.map((d) => ({ id: d.id, z: (d.z ?? 0) - 1 })),
      );
    },

    updateDevice(id, before, after) {
      commit(new UpdateDeviceCommand(id, before, after));
    },

    updateLink(id, before, after) {
      commit(new UpdateLinkCommand(id, before, after));
    },

    renameProject(before, after) {
      commit(new RenameProjectCommand(before, after));
      set({ projectName: after });
    },

    setMode(mode) {
      set({ mode });
    },

    setProjection(p) {
      set({ projection: p });
    },

    endEdit() {
      // Close the current coalescing window so the next field edit is its own undo.
      history.commitCoalesceBoundary();
      set({ canUndo: history.canUndo, canRedo: history.canRedo });
    },

    markSaved() {
      set({ dirty: false });
    },

    deleteSelection() {
      const ids = [...get().selection];
      if (ids.length === 0) return;
      // Locked devices/objects, and anything on a locked layer, are protected.
      const layerLocked = (lid: string) => model.layers.get(lid)?.locked ?? false;
      const deviceIds = ids.filter((id) => {
        const d = model.devices.get(id);
        return d && !d.locked && !layerLocked(d.layerId);
      });
      const linkIds = ids.filter((id) => {
        const l = model.links.get(id);
        return l && !layerLocked(l.layerId);
      });
      const objectIds = ids.filter((id) => {
        const o = model.objects.get(id);
        return o && !o.locked && !layerLocked(o.layerId);
      });
      if (deviceIds.length === 0 && linkIds.length === 0 && objectIds.length === 0)
        return;
      commit(new DeleteCommand(deviceIds, linkIds, objectIds), { reindex: true });
      history.commitCoalesceBoundary();
      set({ selection: new Set() });
    },

    select(ids, additive = false) {
      const next = additive ? new Set(get().selection) : new Set<string>();
      for (const id of ids) next.add(id);
      set({ selection: next });
    },

    boxSelect(box, additive = false) {
      const next = additive ? new Set(get().selection) : new Set<string>();
      for (const id of index.query(box)) next.add(id);
      set({ selection: next });
    },

    lassoSelect(points, additive = false) {
      const next = additive ? new Set(get().selection) : new Set<string>();
      const inside = (x: number, y: number) => pointInPolygon(x, y, points);
      for (const d of model.devices.values()) {
        if (inside(d.x + d.width / 2, d.y + d.height / 2)) next.add(d.id);
      }
      for (const o of model.objects.values()) {
        if (inside(o.x + o.width / 2, o.y + o.height / 2)) next.add(o.id);
      }
      set({ selection: next });
    },

    selectAll() {
      set({
        selection: new Set([
          ...model.devices.keys(),
          ...model.objects.keys(),
          ...model.links.keys(),
        ]),
      });
    },

    clearSelection() {
      set({ selection: new Set() });
    },

    duplicateSelection() {
      const ids = [...get().selection].filter((id) => movable(id));
      if (ids.length === 0) return;
      const clones = remapCloneGroups(
        ids.map((id) => {
          const m = movable(id)!;
          return cloneMovable(m, m.x + 24, m.y + 24, m.layerId);
        }),
      );
      history.dispatch(
        transaction(
          'Duplicate',
          clones.map((c) =>
            c.kind === 'device' ? new AddDeviceCommand(c) : new AddObjectCommand(c),
          ),
        ),
        model,
      );
      for (const c of clones)
        index.insert(c.id, c.kind === 'device' ? deviceBox(c) : objBox(c));
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        selection: new Set(clones.map((c) => c.id)),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    focusObject(id) {
      // For a link, focus its source device (links have no box of their own).
      const link = model.links.get(id);
      const targetId = link ? link.sourceId : id;
      set({
        selection: new Set([id]),
        focusTarget: targetId,
        focusTick: get().focusTick + 1,
      });
    },

    undo() {
      if (history.undo(model)) {
        rebuildIndex();
        activeViewHiddenLayers = null;
        const activeLayerId = model.layers.has(get().activeLayerId)
          ? get().activeLayerId
          : (model.layers.keys().next().value ?? 'default');
        set({
          rev: get().rev + 1,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          dirty: true,
          projectName: model.project.name,
          activeLayerId,
          activeViewId: null,
        });
      }
    },

    redo() {
      if (history.redo(model)) {
        rebuildIndex();
        activeViewHiddenLayers = null;
        const activeLayerId = model.layers.has(get().activeLayerId)
          ? get().activeLayerId
          : (model.layers.keys().next().value ?? 'default');
        set({
          rev: get().rev + 1,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          dirty: true,
          projectName: model.project.name,
          activeLayerId,
          activeViewId: null,
        });
      }
    },

    runValidation() {
      resetIssueIds();
      const issues = validate({
        devices: [...model.devices.values()],
        links: [...model.links.values()],
        vlans: [...model.vlans.values()],
        subnets: [...model.subnets.values()],
        racks: [...model.racks.values()],
      });
      set({ issues });
    },

    loadDoc(doc) {
      model = fromDocument(doc);
      baseDoc = doc;
      history.clear();
      rebuildIndex();
      resetIssueIds();
      activeViewHiddenLayers = null;
      pendingCamera = null;
      set({
        rev: get().rev + 1,
        selection: new Set(),
        issues: validate({
          devices: [...model.devices.values()],
          links: [...model.links.values()],
          vlans: [...model.vlans.values()],
          subnets: [...model.subnets.values()],
          racks: [...model.racks.values()],
        }),
        canUndo: false,
        canRedo: false,
        dirty: false,
        projectName: doc.project.name,
        activeLayerId: model.layers.keys().next().value ?? 'default',
        activeViewId: null,
        projection: 'flat',
        cameraTick: 0,
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

    getLink(id) {
      return model.links.get(id);
    },

    devicesAll() {
      return [...model.devices.values()];
    },

    linksAll() {
      return [...model.links.values()];
    },

    addVlan(vlanId, name) {
      const v = createVlan(vlanId, name);
      commit(new AddVlanCommand(v));
      history.commitCoalesceBoundary();
      return v.id;
    },
    updateVlan(id, before, after) {
      commit(new UpdateVlanCommand(id, before, after));
    },
    deleteVlan(id) {
      commit(new DeleteVlanCommand(id));
      history.commitCoalesceBoundary();
    },
    vlansAll() {
      return [...model.vlans.values()].sort((a, b) => a.vlanId - b.vlanId);
    },

    addSubnet(cidr) {
      const s = createSubnet(cidr);
      commit(new AddSubnetCommand(s));
      history.commitCoalesceBoundary();
      return s.id;
    },
    updateSubnet(id, before, after) {
      commit(new UpdateSubnetCommand(id, before, after));
    },
    deleteSubnet(id) {
      commit(new DeleteSubnetCommand(id));
      history.commitCoalesceBoundary();
    },
    subnetsAll() {
      return [...model.subnets.values()];
    },

    addRack(name) {
      const r = createRack(name);
      commit(new AddRackCommand(r));
      history.commitCoalesceBoundary();
      return r.id;
    },
    updateRack(id, before, after) {
      commit(new UpdateRackCommand(id, before, after));
    },
    deleteRack(id) {
      commit(new DeleteRackCommand(id));
      history.commitCoalesceBoundary();
    },
    racksAll() {
      return [...model.racks.values()];
    },

    hitTest(x, y) {
      return index.hit(x, y);
    },

    queryBox(box) {
      return index.query(box);
    },

    contentBounds() {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const includeBox = (x: number, y: number, width = 0, height = 0) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      };
      for (const d of model.devices.values()) includeBox(d.x, d.y, d.width, d.height);
      for (const o of model.objects.values()) includeBox(o.x, o.y, o.width, o.height);
      for (const l of model.links.values()) {
        for (const p of l.waypoints ?? []) includeBox(p.x, p.y);
      }
      if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

// Dev-only handle for debugging and E2E driving. Stripped from production builds.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __nexmap?: typeof useProjectStore }).__nexmap =
    useProjectStore;
}
