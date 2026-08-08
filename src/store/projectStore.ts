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
  CalloutBlock,
  CanvasObject,
  Device,
  DeviceType,
  Interface,
  Link,
  Layer,
  Location,
  LocationKind,
  NexMapDocument,
  PortRef,
  Rack,
  RackCable,
  RackCableEnd,
  Subnet,
  TextObject,
  ValidationIssue,
  View,
  Vlan,
} from '@/model/types';
import { bayOrigin, BAY_W } from '@/rack/rackLayout';
import { DEFAULT_LEADER } from '@/model/leader';
import { calloutRowsOrPlaceholder } from '@/model/callout';
import { titleBlockBlocks, legendBlocks, legendEntries } from '@/model/docBlocks';
import { canFit, isFullDepth, type FitResult, type Slot } from '@/rack/rackModel';
import { checkConnect, pruneCablesForInterfaces } from '@/rack/rackCables';
import { presetByKey } from '@/rack/rackDevicePresets';
import { catalogById } from '@/rack/rackCatalog';
import { estimateCableLengthFt } from '@/rack/cableLength';
import {
  isTransitive,
  planPassThroughPairs,
  traceFrom,
  type TraceResult,
} from '@/rack/cableTrace';
import { reconcile, type Reconciliation } from '@/rack/reconcile';
import { proposePowerBalance } from '@/rack/rackPower';
import { pickBulkPatch } from '@/rack/rackBulk';
import { rackFieldsFromPreset, rackPresetById, DEFAULT_RACK_PRESET } from '@/rack/rackTypes';
import type { RackTemplate } from '@/rack/rackTemplates';
import {
  createDevice,
  createEmptyDocument,
  createInterface,
  createLink,
  createImageObject,
  createLayer,
  createLocation,
  createRack,
  createRackCable,
  createShapeObject,
  createSubnet,
  createTextObject,
  createView,
  createVlan,
} from '@/model/schema';
import { cloneBlocks } from '@/model/callout';
import { validate, resetIssueIds } from '@/model/validate';
import { SpatialIndex, type Box } from '@/lib/spatial-index';
import { computeAlignSnap, computeSpacingSnap, type AlignGuide } from '@/canvas/align';
import { autoLayoutPositions } from '@/lib/layout';
import { avoidRoute } from '@/lib/routing';
import { pointInPolygon, type Point } from '@/lib/geometry';
import { parseNexText, buildModel, type Diagnostic as NexDiagnostic } from '@/lib/nextext';
import { analyzeHealth, edgeDisjointPaths, type HealthReport } from '@/lib/health';
import {
  deleteBlockers,
  isBlocked,
  planSiteConversion,
  portPath,
  wouldCycle,
  type DeleteBlockers,
} from '@/model/location';
import { History } from './history';
import {
  AddDeviceCommand,
  AddLayerCommand,
  AddLinkCommand,
  AddLocationCommand,
  AddObjectCommand,
  AddRackCableCommand,
  AddRackCommand,
  AddSubnetCommand,
  AddVlanCommand,
  DeleteCommand,
  DeleteLayerCommand,
  DeleteLocationCommand,
  DeleteRackCableCommand,
  DeleteRackCommand,
  DeleteSubnetCommand,
  DeleteVlanCommand,
  MoveDeviceCommand,
  MoveObjectCommand,
  RenameProjectCommand,
  UpdateDeviceCommand,
  UpdateLayerCommand,
  UpdateLinkCommand,
  UpdateLocationCommand,
  UpdateObjectCommand,
  UpdateRackCableCommand,
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
/** dirty as of gesture start — a cancelled gesture must not mark the doc
    edited (or arm an autosave draft of a byte-identical project). */
let dirtyBeforeDrag = false;
let dirtyBeforeResize = false;
/**
 * Waypoint origins for links whose BOTH endpoints are in the moving selection.
 * Such links translate rigidly with the group (waypoints follow); links with only
 * one endpoint selected reshape as before. Transient — captured at beginDrag.
 */
let dragLinkWaypoints:
  | Map<string, { origins: { x: number; y: number }[]; sourceId: string }>
  | null = null;
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
      blocks: cloneBlocks(item.blocks),
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
  /**
   * The port scope (schema v5). Independent of `selection`, which holds canvas
   * objects: a port is not a canvas object, it lives INSIDE a device. Set by
   * clicking a port row or a trace hop; cleared by any canvas selection change so
   * the inspector can never show a port belonging to gear you just navigated away
   * from.
   */
  selectedPort: PortRef | null;
  issues: ValidationIssue[];
  /** Topology-health report, recomputed on the same debounce as validation. */
  health: HealthReport;
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
  /**
   * Generate a name/vendor callout for every mounted device on `rackId` that
   * doesn't already have one (idempotent), laid out in a column at the rack's
   * right edge and anchored to each device. One undo entry. Returns how many were
   * created.
   */
  annotateRack(rackId: string, side?: 'front' | 'rear'): number;
  /** Add a generated title-block callout (rack-scoped when rackId given). Returns its id. */
  addTitleBlock(rackId?: string): string;
  /** Add a generated legend callout from the rack's (or all) cable colors. Returns its id. */
  addLegend(rackId?: string): string;
  /** Rebuild a title-block/legend callout's content from current data (one undo). */
  regenerateDocBlock(id: string): void;
  /** Begin dragging the current selection — snapshots origin positions. */
  beginDrag(): void;
  /** Move dragged devices by a canvas-space delta (transient, no history). */
  dragTo(dx: number, dy: number, suspendSnap: boolean, scale?: number): void;
  /** Commit the drag as a single undoable entry (no-op if nothing moved). */
  endDrag(): void;
  /** Abort an in-flight drag: restore origins, record NOTHING in history. */
  cancelDrag(): void;
  /** Alignment guide lines for the in-flight drag (read during render). */
  alignGuides(): AlignGuide[];
  /** Begin resizing a single object — snapshots its box (transient). */
  beginResize(id: string): void;
  /** Apply a transient resize box (no history). */
  resizeTo(box: { x: number; y: number; width: number; height: number }): void;
  /** Commit the resize as a single undoable entry (no-op if unchanged). */
  endResize(): void;
  /** Abort an in-flight resize: restore the original box, record nothing. */
  cancelResize(): void;
  connect(sourceId: string, targetId: string): string | null;
  /** Quick-create "Connect to new…" (M4b): create the device AND its link as
      ONE undoable transaction — one gesture, one Cmd+Z. Returns the device id. */
  addDeviceAndConnect(type: DeviceType, x: number, y: number, sourceId: string): string;
  /** Apply imported devices+links as ONE atomic, undoable transaction (DA-T2). */
  importObjects(devices: Device[], links: Link[]): void;
  /** Apply imported VLANs/subnets as one atomic, undoable transaction. */
  importSemantics(subnets: Subnet[], vlans: Vlan[]): void;
  /**
   * Parse NexText and REPLACE the diagram (devices/links/objects/subnets/vlans) with
   * the result, laid out, as one undoable transaction. Aborts without mutating if the
   * source has parse errors. Returns the (possibly warning-only) diagnostics.
   */
  applyNexText(src: string): { ok: boolean; diagnostics: NexDiagnostic[] };
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
  /** Re-route selected links around other devices (A* obstacle avoidance → waypoints). */
  rerouteSelectedLinks(): void;
  /**
   * Re-wire one endpoint of a link to a different device (drag-to-relink). Clears that
   * endpoint's interface ref. Rejects a self-loop (new device == the other endpoint).
   * One undoable transaction; re-validates. Returns true if the link was changed.
   */
  relinkEndpoint(linkId: string, endpoint: 'source' | 'target', newDeviceId: string): boolean;
  /** First-class interfaces (schema v2). */
  addInterface(deviceId: string, name?: string): string | null;
  updateInterface(deviceId: string, ifaceId: string, partial: Partial<Interface>): void;
  /** Remove an interface and clear any link endpoint that referenced it (one transaction). */
  deleteInterface(deviceId: string, ifaceId: string): void;
  /**
   * Wire a patch panel's front ports through to its rear ports (schema v5) in ONE
   * undoable edit — a lazy user must never hand-pair 24 ports. Mirrors front-only
   * panels into new rear ports, or couples existing faces positionally.
   *
   * Returns null when the device is missing or is not a pass-through type, and
   * `{created: 0, coupled: 0}` when everything is already paired (idempotent).
   */
  pairPassThrough(deviceId: string): { created: number; coupled: number } | null;
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
  /** Focus a port. Returns false when the device or interface does not resolve. */
  selectPort(deviceId: string, ifaceId: string): boolean;
  clearSelectedPort(): void;
  /** Walk the physical path out of a port. Pure read — no history entry. */
  tracePort(deviceId: string, ifaceId: string): TraceResult;
  /** Fully-qualified address of a port, e.g. "HQ/28/RK001/SW01/Gi0/1". */
  portLabel(deviceId: string, ifaceId: string): string;
  /**
   * Compare the DESIGNED topology against the PATCHED cabling (schema v5). Pure
   * read, derived on demand — nothing about the delta is persisted.
   */
  reconcileCabling(): Reconciliation;
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
  /** On-demand redundancy: count edge-disjoint paths between two devices (opt-in, not debounced). */
  checkRedundancy(sourceId: string, targetId: string): number;
  loadDoc(doc: NexMapDocument): void;
  getDocument(): NexMapDocument;
  newProject(now: string): void;

  // --- SceneSource read API (renderer reads through these) ---
  visibleDevices(viewport: Box): Device[];
  visibleLinks(viewport: Box): Link[];
  visibleObjects(viewport: Box): CanvasObject[];
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
  /** Append a pre-made template's racks+devices to the row in one undoable edit. Returns new rack ids. */
  applyRackTemplate(template: RackTemplate): string[];
  updateRack(id: string, before: Partial<Rack>, after: Partial<Rack>): void;
  deleteRack(id: string): void;
  /** Deep-copy a rack with its mounted gear and intra-rack cables. Returns the new id. */
  cloneRack(rackId: string): string | null;
  racksAll(): Rack[];
  // Locations (schema v5) — the spatial hierarchy.
  addLocation(name: string, kind: LocationKind, parentId?: string): string;
  updateLocation(id: string, before: Partial<Location>, after: Partial<Location>): void;
  /**
   * Move a node under a new parent (pass `undefined` to promote to a root).
   * REFUSES and returns false if it would create a cycle — the model never holds
   * a cycle we would then have to report.
   */
  reparentLocation(id: string, parentId: string | undefined): boolean;
  /**
   * Delete an EMPTY location. Returns the blockers when it still holds child
   * locations, racks or devices (E14/SD-13): blocked, never cascaded, so a subtree
   * cannot be lost to one click. `null` = deleted.
   */
  deleteLocation(id: string): DeleteBlockers | null;
  /** Point a rack at a location (`undefined` unplaces it). One undoable edit. */
  setRackLocation(rackId: string, locationId: string | undefined): void;
  /** Point a device at a location (`undefined` unplaces it). One undoable edit. */
  setDeviceLocation(deviceId: string, locationId: string | undefined): void;
  /**
   * Convert legacy free-text `Rack.site` values into real site locations
   * (SD-10/OQ-1) as ONE undoable transaction. Never clobbers a rack that already
   * has a `locationId`, and never clears `site`. Returns how many of each it made.
   */
  convertSitesToLocations(): { created: number; assigned: number };
  locationsAll(): Location[];
  // Rack designer (schema v3) — placement + physical cabling.
  /** Validate + write a device's rack slot atomically. Returns the fit result. */
  placeInRack(deviceId: string, rackId: string, slot: Slot): FitResult;
  /** Clear a device's rack placement (move to the unplaced tray). */
  unmountFromRack(deviceId: string): void;
  /** Add a physical cable; returns its id, or null if the connection is invalid. */
  connectRackCable(
    aEnd: RackCableEnd,
    bEnd: RackCableEnd,
    color: string,
    label?: string,
    lengthFt?: number,
  ): string | null;
  updateRackCable(id: string, before: Partial<RackCable>, after: Partial<RackCable>): void;
  /** Estimate + fill length (ft) from rack geometry for every cable missing one. Returns count updated. */
  autoLengthRackCables(): number;
  /** Rebalance A/B power by flipping single-corded gear to even the load. One undo. Returns devices moved. */
  balancePower(): number;
  /** Stamp allowlisted fields (status/owner/assetTag/warranty/feed) onto many devices in one undo. Returns count changed. */
  bulkUpdateDevices(ids: string[], patch: Partial<Device>): number;
  /** Assign sequential asset tags to many devices in one undo. Returns count changed. */
  bulkPrefixAssetTags(ids: string[], prefix: string): number;
  /** Set or clear a device's uploaded photo (extra.rackPhotoDataUri). One undo. */
  setDevicePhoto(deviceId: string, dataUri: string | null): void;
  disconnectRackCable(id: string): void;
  rackCablesAll(): RackCable[];
  getRackCable(id: string): RackCable | undefined;
  /** After a device's interfaces change (E5 re-population), prune now-orphaned cables. */
  pruneInterfaceCables(deviceId: string, validIfaceIds: string[]): void;
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

  /** Generated content for a title-block / legend, from current project data. */
  function docBlockContent(role: 'title-block' | 'legend', rackId?: string): CalloutBlock[] {
    const date = model.project.updatedAt.slice(0, 10); // YYYY-MM-DD, deterministic
    if (role === 'title-block') {
      const rack = rackId ? model.racks.get(rackId) : undefined;
      const deviceCount = rackId
        ? [...model.devices.values()].filter((d) => d.rackId === rackId).length
        : model.devices.size;
      return titleBlockBlocks({
        projectName: model.project.name,
        rackName: rack?.name,
        date,
        deviceCount,
      });
    }
    const cables = rackId
      ? [...model.rackCables.values()].filter(
          (c) => model.devices.get(c.aEnd.deviceId)?.rackId === rackId,
        )
      : [...model.rackCables.values()];
    return legendBlocks(legendEntries(cables));
  }

  /** Create + place a generated document-block callout (column for a rack, else free). */
  function addDocBlock(role: 'title-block' | 'legend', rackId?: string): string {
    const blocks = docBlockContent(role, rackId);
    const width = role === 'legend' ? 240 : 220;
    const height =
      calloutRowsOrPlaceholder(blocks, 14).reduce((s, r) => s + r.size * 1.25, 0) + 12;
    let x = 60;
    let y = 60;
    if (rackId) {
      x = bayOrigin().x + BAY_W + 40;
      y = bayOrigin().y;
      for (const o of model.objects.values()) {
        if (o.kind === 'text' && o.rackScope === rackId) y = Math.max(y, o.y + o.height + 12);
      }
    }
    const obj = createTextObject(x, y, firstLayerId(), {
      width,
      height,
      blocks,
      role,
      ...(rackId ? { rackScope: rackId } : {}),
    });
    history.dispatch(new AddObjectCommand(obj), model);
    if (!rackId) index.insert(obj.id, objBox(obj)); // free callouts join the flat index
    history.commitCoalesceBoundary();
    set({
      rev: get().rev + 1,
      selection: new Set([obj.id]),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      dirty: true,
    });
    return obj.id;
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
    selectedPort: null,
    issues: [],
    health: {
      issues: [],
      score: 100,
      spofIds: [],
      componentCount: 0,
      scanDerived: false,
      criticalLinkPairs: [],
      conflictLinkIds: [],
    },
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

    annotateRack(rackId, side) {
      const rack = model.racks.get(rackId);
      if (!rack) return 0;
      // Only devices on the visible face — a leader can't reach a device the
      // elevation isn't currently showing.
      const devices = [...model.devices.values()].filter(
        (d) =>
          d.rackId === rackId &&
          d.ru != null &&
          (side == null || (d.side ?? 'front') === side),
      );
      const existing = [...model.objects.values()].filter(
        (o): o is TextObject => o.kind === 'text' && o.rackScope === rackId,
      );
      const anchored = new Set(
        existing.map((o) => (o.anchor?.type === 'device' ? o.anchor.id : null)).filter(Boolean),
      );
      // Top of the rack (highest U) first; skip already-annotated devices.
      const todo = devices
        .filter((d) => !anchored.has(d.id))
        .sort((a, b) => (b.ru ?? 0) - (a.ru ?? 0));
      if (todo.length === 0) return 0;

      const colX = bayOrigin().x + BAY_W + 40;
      const W = 220;
      const H = 40;
      const GAP = 12;
      // Continue below the lowest existing callout in the column (no overlaps).
      let y = bayOrigin().y;
      for (const o of existing) y = Math.max(y, o.y + o.height + GAP);

      const cmds = todo.map((d) => {
        const blocks: CalloutBlock[] = [{ kind: 'heading', spans: [{ text: d.name }] }];
        const vm = [d.vendor, d.model].filter(Boolean).join(' ');
        if (vm) blocks.push({ kind: 'subheading', spans: [{ text: vm }] });
        const obj = createTextObject(colX, y, firstLayerId(), {
          width: W,
          height: H,
          blocks,
          rackScope: rackId,
          anchor: { type: 'device', id: d.id },
          leader: { ...DEFAULT_LEADER },
        });
        y += H + GAP;
        return new AddObjectCommand(obj);
      });
      commit(transaction('Annotate devices', cmds));
      history.commitCoalesceBoundary();
      return cmds.length;
    },

    addTitleBlock(rackId) {
      return addDocBlock('title-block', rackId);
    },
    addLegend(rackId) {
      return addDocBlock('legend', rackId);
    },
    regenerateDocBlock(id) {
      const o = model.objects.get(id);
      if (!o || o.kind !== 'text' || !o.role) return;
      const blocks = docBlockContent(o.role, o.rackScope);
      commit(new UpdateObjectCommand(id, { blocks: o.blocks }, { blocks }));
      history.commitCoalesceBoundary();
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
      dirtyBeforeDrag = get().dirty;
      const origins = new Map<string, { x: number; y: number }>();
      for (const id of get().selection) {
        const m = movable(id);
        // Locked entities and entities on a locked layer don't move.
        if (m && !m.locked && !model.layers.get(m.layerId)?.locked) {
          origins.set(id, { x: m.x, y: m.y });
        }
      }
      dragOrigins = origins;

      // Links whose BOTH endpoints move translate rigidly: remember their waypoint
      // origins so dragTo can carry the bends along with the group. (Single-endpoint
      // links are skipped here, so they reshape as the moved end follows its node.)
      const linkWp = new Map<
        string,
        { origins: { x: number; y: number }[]; sourceId: string }
      >();
      for (const l of model.links.values()) {
        if (!l.waypoints?.length) continue;
        if (origins.has(l.sourceId) && origins.has(l.targetId)) {
          linkWp.set(l.id, {
            origins: l.waypoints.map((p) => ({ x: p.x, y: p.y })),
            sourceId: l.sourceId,
          });
        }
      }
      dragLinkWaypoints = linkWp;
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

          // Equal-spacing snap on any axis edge-alignment didn't already claim. Uses a
          // wider neighbor set since spacing references can be farther than the edge margin.
          if (adjX === null || adjY === null) {
            const wide = 600 / scale;
            const spacingStatics: Box[] = [];
            for (const id of index.query({
              x: moving.x - wide,
              y: moving.y - wide,
              width: moving.width + wide * 2,
              height: moving.height + wide * 2,
            })) {
              if (dragOrigins.has(id)) continue;
              const m = movable(id);
              if (m) spacingStatics.push({ x: m.x, y: m.y, width: m.width, height: m.height });
            }
            const spacing = computeSpacingSnap(moving, spacingStatics, threshold);
            if (adjX === null) adjX = spacing.adjX;
            if (adjY === null) adjY = spacing.adjY;
          }
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

      // Carry waypoints of fully-grouped links by the same net delta their source
      // node moved, so the connector stays rigid relative to the group.
      if (dragLinkWaypoints) {
        for (const [linkId, info] of dragLinkWaypoints) {
          const link = model.links.get(linkId);
          const srcOrigin = dragOrigins.get(info.sourceId);
          const srcDev = model.devices.get(info.sourceId);
          if (!link || !srcOrigin || !srcDev) continue;
          const ndx = srcDev.x - srcOrigin.x;
          const ndy = srcDev.y - srcOrigin.y;
          model.links.set(linkId, {
            ...link,
            waypoints: info.origins.map((p) => ({ x: p.x + ndx, y: p.y + ndy })),
          });
        }
      }

      set({ rev: get().rev + 1, dirty: true });
    },

    alignGuides() {
      return alignGuides;
    },

    beginResize(id) {
      dirtyBeforeResize = get().dirty;
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

    cancelResize() {
      // Abort path (Escape / pointercancel mid-resize): restore the original
      // box, record nothing.
      if (!resizeOrig) return;
      const { id, box } = resizeOrig;
      resizeOrig = null;
      const o = model.objects.get(id);
      if (!o) return;
      model.objects.set(id, { ...o, ...box });
      index.update(id, { x: box.x, y: box.y, width: box.width, height: box.height });
      set({ rev: get().rev + 1, dirty: dirtyBeforeResize });
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
      // Record rigid waypoint moves in the SAME transaction so one undo restores
      // both the nodes and the connector bends.
      if (dragLinkWaypoints) {
        for (const [linkId, info] of dragLinkWaypoints) {
          const link = model.links.get(linkId);
          if (!link) continue;
          const before = info.origins;
          const after = link.waypoints ?? [];
          const moved = after.some(
            (p, i) => !before[i] || p.x !== before[i]!.x || p.y !== before[i]!.y,
          );
          if (moved) {
            moves.push(new UpdateLinkCommand(linkId, { waypoints: before }, { waypoints: after }));
          }
        }
      }
      dragLinkWaypoints = null;
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

    cancelDrag() {
      // Escape / Cmd+Z / pointercancel mid-drag: put everything back exactly
      // where beginDrag found it. No history entry — the gesture never
      // happened. (Undo-over-live-drag was the stale-dragOrigins corruption;
      // this is the abort path the keyboard router calls first.)
      alignGuides = [];
      if (!dragOrigins) return;
      for (const [id, origin] of dragOrigins) {
        const d = model.devices.get(id);
        if (d) {
          model.devices.set(id, { ...d, x: origin.x, y: origin.y });
          index.update(id, { x: origin.x, y: origin.y, width: d.width, height: d.height });
          continue;
        }
        const o = model.objects.get(id);
        if (o) {
          model.objects.set(id, { ...o, x: origin.x, y: origin.y });
          index.update(id, { x: origin.x, y: origin.y, width: o.width, height: o.height });
        }
      }
      if (dragLinkWaypoints) {
        for (const [linkId, info] of dragLinkWaypoints) {
          const link = model.links.get(linkId);
          if (!link) continue;
          model.links.set(linkId, {
            ...link,
            waypoints: info.origins.map((p) => ({ x: p.x, y: p.y })),
          });
        }
      }
      dragLinkWaypoints = null;
      dragOrigins = null;
      set({ rev: get().rev + 1, dirty: dirtyBeforeDrag });
    },

    connect(sourceId, targetId) {
      if (sourceId === targetId) return null;
      if (!model.devices.has(sourceId) || !model.devices.has(targetId)) return null;
      const link = createLink(sourceId, targetId, firstLayerId());
      commit(new AddLinkCommand(link));
      history.commitCoalesceBoundary();
      return link.id;
    },

    addDeviceAndConnect(type, x, y, sourceId) {
      const device = createDevice(type, x, y, firstLayerId());
      const cmds: Command[] = [new AddDeviceCommand(device)];
      if (model.devices.has(sourceId)) {
        cmds.push(new AddLinkCommand(createLink(sourceId, device.id, firstLayerId())));
      }
      history.dispatch(transaction('Quick-create device', cmds), model);
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

    applyNexText(src) {
      const result = parseNexText(src);
      if (result.diagnostics.some((d) => d.severity === 'error')) {
        return { ok: false, diagnostics: result.diagnostics };
      }
      const built = buildModel(result, { layerId: firstLayerId() });

      // Replace the whole diagram in one undoable transaction: clear existing
      // devices (links cascade), objects, subnets, and vlans, then add the new ones.
      const cmds: Command[] = [];
      const deviceIds = [...model.devices.keys()];
      const objectIds = [...model.objects.keys()];
      if (deviceIds.length || objectIds.length) {
        cmds.push(new DeleteCommand(deviceIds, [], objectIds));
      }
      for (const id of model.subnets.keys()) cmds.push(new DeleteSubnetCommand(id));
      for (const id of model.vlans.keys()) cmds.push(new DeleteVlanCommand(id));
      for (const d of built.devices) cmds.push(new AddDeviceCommand(d));
      for (const l of built.links) cmds.push(new AddLinkCommand(l));
      for (const s of built.subnets) cmds.push(new AddSubnetCommand(s));
      for (const v of built.vlans) cmds.push(new AddVlanCommand(v));

      history.dispatch(transaction('Apply NexText', cmds), model);
      history.commitCoalesceBoundary();
      rebuildIndex();
      resetIssueIds();
      set({
        rev: get().rev + 1,
        selection: new Set(),
        selectedPort: null,
        issues: validate({
          devices: [...model.devices.values()],
          links: [...model.links.values()],
          vlans: [...model.vlans.values()],
          subnets: [...model.subnets.values()],
          racks: [...model.racks.values()],
          locations: [...model.locations.values()],
        }),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
      return { ok: true, diagnostics: result.diagnostics };
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
      const idSet = new Set(ids);
      const cmds: Command[] = ids.map((id) => {
        const m = movable(id)!;
        return model.devices.has(id)
          ? new MoveDeviceCommand(id, { x: m.x, y: m.y }, { x: m.x + dx, y: m.y + dy })
          : new MoveObjectCommand(id, { x: m.x, y: m.y }, { x: m.x + dx, y: m.y + dy });
      });
      // Fully-grouped links carry their waypoints by the same delta (matches drag).
      for (const l of model.links.values()) {
        if (!l.waypoints?.length) continue;
        if (idSet.has(l.sourceId) && idSet.has(l.targetId)) {
          const before = l.waypoints.map((p) => ({ x: p.x, y: p.y }));
          const after = before.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          cmds.push(new UpdateLinkCommand(l.id, { waypoints: before }, { waypoints: after }));
        }
      }
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

    rerouteSelectedLinks() {
      const sel = get().selection;
      const boxes = [...model.devices.values()].map((d) => ({ id: d.id, box: deviceBox(d) }));
      const cmds: Command[] = [];
      for (const id of sel) {
        const l = model.links.get(id);
        if (!l) continue;
        const a = model.devices.get(l.sourceId);
        const b = model.devices.get(l.targetId);
        if (!a || !b) continue;
        const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
        const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        const obstacles = boxes
          .filter((o) => o.id !== l.sourceId && o.id !== l.targetId)
          .map((o) => o.box);
        const route = avoidRoute(ca, cb, obstacles);
        const wp = route && route.length > 2 ? route.slice(1, -1) : [];
        const before = l.waypoints ?? [];
        cmds.push(
          new UpdateLinkCommand(
            id,
            { waypoints: before, routing: l.routing },
            { waypoints: wp, routing: 'orthogonal' },
          ),
        );
      }
      if (cmds.length === 0) return;
      history.dispatch(transaction('Reroute', cmds), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
    },

    relinkEndpoint(linkId, endpoint, newDeviceId) {
      const link = model.links.get(linkId);
      if (!link || !model.devices.has(newDeviceId)) return false;
      const otherId = endpoint === 'source' ? link.targetId : link.sourceId;
      if (newDeviceId === otherId) return false; // self-loop — reject
      const idKey = endpoint === 'source' ? 'sourceId' : 'targetId';
      const ifaceKey = endpoint === 'source' ? 'sourceIfaceId' : 'targetIfaceId';
      const labelKey = endpoint === 'source' ? 'sourceInterface' : 'targetInterface';
      if (link[idKey] === newDeviceId) return false; // no change
      commit(
        new UpdateLinkCommand(
          linkId,
          { [idKey]: link[idKey], [ifaceKey]: link[ifaceKey], [labelKey]: link[labelKey] },
          { [idKey]: newDeviceId, [ifaceKey]: undefined, [labelKey]: undefined },
        ),
      );
      get().runValidation();
      return true;
    },

    addInterface(deviceId, name) {
      const d = model.devices.get(deviceId);
      if (!d) return null;
      const existing = d.interfaces ?? [];
      const iface = createInterface(name ?? `eth${existing.length}`);
      commit(
        new UpdateDeviceCommand(
          deviceId,
          { interfaces: existing },
          { interfaces: [...existing, iface] },
        ),
      );
      return iface.id;
    },

    updateInterface(deviceId, ifaceId, partial) {
      const d = model.devices.get(deviceId);
      if (!d) return;
      const existing = d.interfaces ?? [];
      const next = existing.map((i) => (i.id === ifaceId ? { ...i, ...partial } : i));
      commit(
        new UpdateDeviceCommand(deviceId, { interfaces: existing }, { interfaces: next }),
      );
    },

    pairPassThrough(deviceId) {
      const d = model.devices.get(deviceId);
      if (!d) return null;
      // Refuse non-panels: the trace engine only passes through patch panels, so
      // coupling a switch would create wiring that is silently never followed.
      if (!isTransitive(d.type)) return null;

      const existing = d.interfaces ?? [];
      const plan = planPassThroughPairs(d);
      if (plan.createRear.length === 0 && plan.couple.length === 0) {
        return { created: 0, coupled: 0 };
      }

      // Copy first: the `before` snapshot must keep pointing at the untouched array.
      const next = existing.map((i) => ({ ...i }));
      const byId = new Map(next.map((i) => [i.id, i]));

      for (const { frontIfaceId, rearIfaceId } of plan.couple) {
        const front = byId.get(frontIfaceId);
        const rear = byId.get(rearIfaceId);
        if (!front || !rear) continue;
        front.side = 'front';
        front.throughTo = rear.id;
        rear.side = 'rear';
        rear.throughTo = front.id;
      }

      for (const { frontIfaceId, name } of plan.createRear) {
        const front = byId.get(frontIfaceId);
        if (!front) continue;
        // `kind` carries the media (RJ45 / LC), which is physically identical on both
        // faces of a pass-through. Speed and VLAN are usage properties, not wiring,
        // so the rear port starts clean.
        const rear = createInterface(name, {
          side: 'rear',
          throughTo: front.id,
          ...(front.kind ? { kind: front.kind } : {}),
        });
        front.side = 'front';
        front.throughTo = rear.id;
        next.push(rear);
      }

      // Boundary BEFORE the commit, not just after. This action emits an
      // UpdateDeviceCommand keyed on `interfaces` — exactly what `addInterface`
      // emits — so without a leading boundary it MERGES BACKWARDS into a preceding
      // run of port additions and one undo wipes the ports too.
      history.commitCoalesceBoundary();
      commit(
        new UpdateDeviceCommand(deviceId, { interfaces: existing }, { interfaces: next }),
      );
      history.commitCoalesceBoundary();
      get().runValidation();
      return { created: plan.createRear.length, coupled: plan.couple.length };
    },

    deleteInterface(deviceId, ifaceId) {
      const d = model.devices.get(deviceId);
      if (!d) return;
      const existing = d.interfaces ?? [];
      const next = existing.filter((i) => i.id !== ifaceId);
      if (next.length === existing.length) return;
      const cmds: Command[] = [
        new UpdateDeviceCommand(deviceId, { interfaces: existing }, { interfaces: next }),
      ];
      // Cascade: clear any link endpoint that referenced this interface.
      for (const l of model.links.values()) {
        const before: Partial<Link> = {};
        const after: Partial<Link> = {};
        if (l.sourceId === deviceId && l.sourceIfaceId === ifaceId) {
          before.sourceIfaceId = l.sourceIfaceId;
          before.sourceInterface = l.sourceInterface;
          after.sourceIfaceId = undefined;
          after.sourceInterface = undefined;
        }
        if (l.targetId === deviceId && l.targetIfaceId === ifaceId) {
          before.targetIfaceId = l.targetIfaceId;
          before.targetInterface = l.targetInterface;
          after.targetIfaceId = undefined;
          after.targetInterface = undefined;
        }
        if (Object.keys(after).length > 0) cmds.push(new UpdateLinkCommand(l.id, before, after));
      }
      // Cascade: drop any rack cable whose endpoint referenced this interface. Folded
      // into the SAME transaction as the port removal so deleting a cabled port and
      // cleaning up its cable undo together — otherwise the cable orphans (stale ifaceId
      // that survives save/load, vanishes from the render, but lingers in the CSV export).
      const validIfaceIds = next.map((i) => i.id);
      const keptCables = pruneCablesForInterfaces([...model.rackCables.values()], deviceId, validIfaceIds);
      for (const c of model.rackCables.values()) {
        if (!keptCables.some((k) => k.id === c.id)) cmds.push(new DeleteRackCableCommand(c.id));
      }
      history.dispatch(transaction('Delete interface', cmds), model);
      history.commitCoalesceBoundary();
      set({
        rev: get().rev + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        dirty: true,
      });
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
      // Deleting gear can strand the port scope on a device that no longer exists.
      // The inspector also resolves defensively, but clearing here keeps state honest.
      set({ selection: new Set(), selectedPort: null });
    },

    select(ids, additive = false) {
      const next = additive ? new Set(get().selection) : new Set<string>();
      for (const id of ids) next.add(id);
      set({ selection: next, selectedPort: null });
    },

    boxSelect(box, additive = false) {
      const next = additive ? new Set(get().selection) : new Set<string>();
      for (const id of index.query(box)) next.add(id);
      set({ selection: next, selectedPort: null });
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
      set({ selection: next, selectedPort: null });
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
      set({ selection: new Set(), selectedPort: null });
    },

    selectPort(deviceId, ifaceId) {
      const d = model.devices.get(deviceId);
      if (!d) return false;
      if (!(d.interfaces ?? []).some((i) => i.id === ifaceId)) return false;
      set({ selectedPort: { deviceId, ifaceId } });
      return true;
    },

    clearSelectedPort() {
      if (get().selectedPort) set({ selectedPort: null });
    },

    tracePort(deviceId, ifaceId) {
      return traceFrom([...model.devices.values()], [...model.rackCables.values()], {
        deviceId,
        ifaceId,
      });
    },

    reconcileCabling() {
      return reconcile(
        [...model.devices.values()],
        [...model.links.values()],
        [...model.rackCables.values()],
      );
    },

    portLabel(deviceId, ifaceId) {
      return portPath(
        [...model.locations.values()],
        [...model.racks.values()],
        [...model.devices.values()],
        deviceId,
        ifaceId,
      );
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
      const devices = [...model.devices.values()];
      const links = [...model.links.values()];
      const issues = validate({
        devices,
        links,
        vlans: [...model.vlans.values()],
        subnets: [...model.subnets.values()],
        racks: [...model.racks.values()],
        locations: [...model.locations.values()],
      });
      // Topology health rides the same debounce — all O(V+E), main-thread (eng-review lock).
      const health = analyzeHealth(devices, links);
      set({ issues, health });
    },

    checkRedundancy(sourceId, targetId) {
      return edgeDisjointPaths(
        [...model.devices.values()],
        [...model.links.values()],
        sourceId,
        targetId,
      );
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
          locations: [...model.locations.values()],
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

    visibleObjects(viewport) {
      // Objects (shapes/zones/text/image underlays) share the spatial index with
      // devices, so the same query culls off-screen ones on large diagrams.
      const out: CanvasObject[] = [];
      for (const id of index.query(viewport)) {
        const o = model.objects.get(id);
        if (o) out.push(o);
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
      // Cascade: rack-scoped callouts are deleted with the rack, in ONE undo entry.
      const calloutIds = [...model.objects.values()]
        .filter((o) => o.kind === 'text' && o.rackScope === id)
        .map((o) => o.id);
      if (calloutIds.length > 0) {
        commit(
          transaction('Delete rack', [
            new DeleteRackCommand(id),
            new DeleteCommand([], [], calloutIds),
          ]),
        );
      } else {
        commit(new DeleteRackCommand(id));
      }
      history.commitCoalesceBoundary();
    },
    addLocation(name, kind, parentId) {
      const l = createLocation(name, kind, parentId ? { parentId } : {});
      commit(new AddLocationCommand(l));
      history.commitCoalesceBoundary();
      get().runValidation();
      return l.id;
    },
    updateLocation(id, before, after) {
      commit(new UpdateLocationCommand(id, before, after));
      get().runValidation();
    },
    reparentLocation(id, parentId) {
      if (!model.locations.has(id)) return false;
      // Guard BEFORE writing: a command's contract is reversibility, not legality.
      if (parentId != null && !model.locations.has(parentId)) return false;
      const locs = [...model.locations.values()];
      if (wouldCycle(locs, id, parentId)) return false;
      const current = model.locations.get(id)!;
      if ((current.parentId ?? undefined) === (parentId ?? undefined)) return true;
      commit(
        new UpdateLocationCommand(
          id,
          { parentId: current.parentId },
          { parentId: parentId },
        ),
      );
      history.commitCoalesceBoundary();
      get().runValidation();
      return true;
    },
    deleteLocation(id) {
      if (!model.locations.has(id)) return null;
      const blockers = deleteBlockers(
        [...model.locations.values()],
        [...model.racks.values()],
        [...model.devices.values()],
        id,
      );
      if (isBlocked(blockers)) return blockers;
      commit(new DeleteLocationCommand(id));
      history.commitCoalesceBoundary();
      get().runValidation();
      return null;
    },
    setRackLocation(rackId, locationId) {
      const r = model.racks.get(rackId);
      if (!r) return;
      if (locationId != null && !model.locations.has(locationId)) return;
      commit(
        new UpdateRackCommand(rackId, { locationId: r.locationId }, { locationId }),
      );
      history.commitCoalesceBoundary();
      get().runValidation();
    },
    setDeviceLocation(deviceId, locationId) {
      const d = model.devices.get(deviceId);
      if (!d) return;
      if (locationId != null && !model.locations.has(locationId)) return;
      commit(
        new UpdateDeviceCommand(deviceId, { locationId: d.locationId }, { locationId }),
      );
      history.commitCoalesceBoundary();
      get().runValidation();
    },
    convertSitesToLocations() {
      const plan = planSiteConversion([...model.racks.values()]);
      if (plan.names.length === 0) return { created: 0, assigned: 0 };

      // Mint the sites first so their ids are known, then point the racks at them —
      // all inside ONE transaction, so undo restores the exact prior state.
      const created = plan.names.map((name) => createLocation(name, 'site'));
      const cmds: Command[] = created.map((l) => new AddLocationCommand(l));
      for (const [rackId, nameIdx] of plan.assign) {
        const rack = model.racks.get(rackId);
        if (!rack) continue;
        cmds.push(
          new UpdateRackCommand(
            rackId,
            { locationId: rack.locationId },
            { locationId: created[nameIdx]!.id },
          ),
        );
      }
      commit(transaction('Convert sites to locations', cmds));
      history.commitCoalesceBoundary();
      get().runValidation();
      return { created: created.length, assigned: plan.assign.size };
    },
    locationsAll() {
      return [...model.locations.values()];
    },

    cloneRack(rackId) {
      const src = model.racks.get(rackId);
      if (!src) return null;
      const newRackId = newId();
      // Drop `order` so the clone falls to the end of the row (insertion order). Copying it
      // would give two racks the same order key → a reorder dead-spot.
      const newRack: Rack = { ...src, id: newRackId, name: `${src.name} (copy)`, order: undefined };

      // Clone mounted gear with fresh device + interface ids, remembering the remaps so
      // intra-rack cables can be rewired. Cross-rack cables are intentionally dropped.
      const srcDevices = [...model.devices.values()].filter((d) => d.rackId === rackId && d.ru != null);
      const devIdMap = new Map<string, string>();
      const ifaceIdMap = new Map<string, string>(); // `${oldDevId}:${oldIfaceId}` → newIfaceId
      const newDevices: Device[] = srcDevices.map((d) => {
        const nid = newId();
        devIdMap.set(d.id, nid);
        const interfaces = (d.interfaces ?? []).map((i) => {
          const niface = newId();
          ifaceIdMap.set(`${d.id}:${i.id}`, niface);
          return { ...i, id: niface };
        });
        return { ...d, id: nid, rackId: newRackId, interfaces, groupId: undefined };
      });

      const srcDevIds = new Set(srcDevices.map((d) => d.id));
      const newCables: RackCable[] = [...model.rackCables.values()]
        .filter((c) => srcDevIds.has(c.aEnd.deviceId) && srcDevIds.has(c.bEnd.deviceId))
        .map((c) => ({
          ...c,
          id: newId(),
          aEnd: { deviceId: devIdMap.get(c.aEnd.deviceId)!, ifaceId: ifaceIdMap.get(`${c.aEnd.deviceId}:${c.aEnd.ifaceId}`) ?? c.aEnd.ifaceId },
          bEnd: { deviceId: devIdMap.get(c.bEnd.deviceId)!, ifaceId: ifaceIdMap.get(`${c.bEnd.deviceId}:${c.bEnd.ifaceId}`) ?? c.bEnd.ifaceId },
        }));

      const cmds: Command[] = [
        new AddRackCommand(newRack),
        ...newDevices.map((d) => new AddDeviceCommand(d)),
        ...newCables.map((c) => new AddRackCableCommand(c)),
      ];
      history.dispatch(transaction('Clone rack', cmds), model);
      for (const d of newDevices) index.insert(d.id, deviceBox(d));
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return newRackId;
    },
    applyRackTemplate(template) {
      // Append to the end of the current row so applying a template is never destructive.
      let order = [...model.racks.values()].length;
      const cmds: Command[] = [];
      const newDevices: Device[] = [];
      const newRackIds: string[] = [];
      for (const tr of template.racks) {
        const preset = rackPresetById(tr.rackPresetId) ?? DEFAULT_RACK_PRESET;
        const rack = createRack(tr.name, preset.ruHeight, { ...rackFieldsFromPreset(preset), order: order++ });
        newRackIds.push(rack.id);
        cmds.push(new AddRackCommand(rack));
        for (const td of tr.devices) {
          const p = presetByKey(td.presetKey);
          if (!p) continue;
          const catalog = td.catalogId ? catalogById(td.catalogId) : undefined;
          const interfaces = p.ports > 0
            ? Array.from({ length: p.ports }, (_, i) => createInterface(p.portName(i)))
            : [];
          const dev = createDevice(p.type, -9999, -9999, firstLayerId(), {
            ...(td.name ? { name: td.name } : {}),
            ...(catalog ? { vendor: catalog.vendor, model: catalog.model } : {}),
            interfaces,
            rackId: rack.id,
            ru: td.ru,
            ruSpan: p.span,
            mount: p.mount ?? 'rack',
            side: td.side ?? 'front',
            bay: 'full',
            ...((catalog?.watts ?? p.watts) ? { watts: catalog?.watts ?? p.watts } : {}),
            ...((catalog?.weightKg ?? p.weightKg) ? { weightKg: catalog?.weightKg ?? p.weightKg } : {}),
          });
          newDevices.push(dev);
          cmds.push(new AddDeviceCommand(dev));
        }
      }
      if (!cmds.length) return [];
      history.dispatch(transaction('Apply template', cmds), model);
      for (const dv of newDevices) index.insert(dv.id, deviceBox(dv));
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return newRackIds;
    },
    racksAll() {
      return [...model.racks.values()];
    },

    // ─── Rack designer (schema v3) ───────────────────────────────────────────
    placeInRack(deviceId, rackId, slot) {
      const device = model.devices.get(deviceId);
      const rack = model.racks.get(rackId);
      if (!device || !rack) return { ok: false, reason: 'invalid' };
      const occupants = [...model.devices.values()].filter((d) => d.rackId === rackId);
      // Depth is a property of THIS device's type, not whatever the caller passed — derive it
      // so a full-depth chassis correctly blocks the opposite face.
      const candidate: Slot = { ...slot, depth: isFullDepth(device.type) ? 'full' : 'shallow' };
      const fit = canFit(rack, occupants, candidate, deviceId);
      if (!fit.ok) return fit;
      const before: Partial<Device> = {
        rackId: device.rackId,
        ru: device.ru,
        ruSpan: device.ruSpan,
        mount: device.mount,
        side: device.side,
        bay: device.bay,
      };
      const after: Partial<Device> = {
        rackId,
        ru: slot.ru,
        ruSpan: slot.ruSpan,
        mount: slot.mount,
        side: slot.side,
        bay: slot.bay,
      };
      commit(new UpdateDeviceCommand(deviceId, before, after));
      history.commitCoalesceBoundary();
      return { ok: true };
    },
    unmountFromRack(deviceId) {
      const d = model.devices.get(deviceId);
      if (!d || d.rackId == null) return;
      commit(
        new UpdateDeviceCommand(
          deviceId,
          { rackId: d.rackId, ru: d.ru, ruSpan: d.ruSpan, mount: d.mount, side: d.side, bay: d.bay },
          { rackId: undefined, ru: undefined, ruSpan: undefined, mount: undefined, side: undefined, bay: undefined },
        ),
      );
      history.commitCoalesceBoundary();
    },
    connectRackCable(aEnd, bEnd, color, label, lengthFt) {
      const existing = [...model.rackCables.values()];
      const hasEnd = (end: RackCableEnd) => {
        const d = model.devices.get(end.deviceId);
        return (d?.interfaces ?? []).some((iface) => iface.id === end.ifaceId);
      };
      if (!hasEnd(aEnd) || !hasEnd(bEnd)) return null;
      if (!checkConnect(existing, aEnd, bEnd).ok) return null;
      const cable = createRackCable(aEnd, bEnd, color, {
        ...(label ? { label } : {}),
        ...(lengthFt != null && Number.isFinite(lengthFt) && lengthFt > 0 ? { lengthFt } : {}),
      });
      commit(new AddRackCableCommand(cable));
      history.commitCoalesceBoundary();
      return cable.id;
    },
    updateRackCable(id, before, after) {
      commit(new UpdateRackCableCommand(id, before, after));
    },
    autoLengthRackCables() {
      const racks = [...model.racks.values()];
      const cmds: Command[] = [];
      for (const c of model.rackCables.values()) {
        if (c.lengthFt != null) continue; // respect a length the user typed
        const a = model.devices.get(c.aEnd.deviceId);
        const b = model.devices.get(c.bEnd.deviceId);
        if (!a || !b) continue;
        const est = estimateCableLengthFt(a, b, racks);
        if (est == null) continue;
        cmds.push(new UpdateRackCableCommand(c.id, { lengthFt: undefined }, { lengthFt: est }));
      }
      if (!cmds.length) return 0;
      history.dispatch(transaction('Auto-length cables', cmds), model);
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return cmds.length;
    },

    balancePower() {
      const proposal = proposePowerBalance([...model.devices.values()]);
      if (!proposal.flips.length) return 0;
      const cmds: Command[] = proposal.flips.map(
        (f) => new UpdateDeviceCommand(f.deviceId, { powerFeed: f.from }, { powerFeed: f.to }),
      );
      history.dispatch(transaction('Balance power feeds', cmds), model);
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return cmds.length;
    },

    bulkUpdateDevices(ids, patch) {
      const after = pickBulkPatch(patch);
      const keys = Object.keys(after) as (keyof typeof after)[];
      if (!keys.length) return 0;
      const cmds: Command[] = [];
      for (const id of ids) {
        const d = model.devices.get(id);
        if (!d) continue; // skip stale/unknown ids rather than aborting the batch
        // Capture only the keys we change as `before` so undo restores exactly those.
        const before: Partial<Device> = {};
        let changed = false;
        for (const k of keys) {
          if (d[k] !== after[k]) {
            (before as Record<string, unknown>)[k] = d[k];
            changed = true;
          }
        }
        if (changed) cmds.push(new UpdateDeviceCommand(id, before, after));
      }
      if (!cmds.length) return 0;
      history.dispatch(transaction('Bulk edit devices', cmds), model);
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return cmds.length;
    },

    bulkPrefixAssetTags(ids, prefix) {
      const clean = prefix.trim();
      if (!ids.length || !clean) return 0;
      const cmds: Command[] = [];
      let next = 1;
      for (const id of ids) {
        const d = model.devices.get(id);
        if (!d) continue;
        const assetTag = `${clean}-${String(next).padStart(3, '0')}`;
        next += 1;
        if (d.assetTag === assetTag) continue;
        cmds.push(new UpdateDeviceCommand(id, { assetTag: d.assetTag }, { assetTag }));
      }
      if (!cmds.length) return 0;
      history.dispatch(transaction('Assign asset tags', cmds), model);
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
      return cmds.length;
    },

    setDevicePhoto(deviceId, dataUri) {
      const d = model.devices.get(deviceId);
      if (!d) return;
      const nextExtra = { ...(d.extra ?? {}) };
      if (dataUri) nextExtra.rackPhotoDataUri = dataUri;
      else delete nextExtra.rackPhotoDataUri;
      const after = Object.keys(nextExtra).length ? nextExtra : undefined;
      // Boundary so each photo set/remove is its own undo step (UpdateDeviceCommand otherwise
      // coalesces consecutive same-device edits).
      history.dispatch(new UpdateDeviceCommand(deviceId, { extra: d.extra }, { extra: after }), model);
      history.commitCoalesceBoundary();
      set({ rev: get().rev + 1, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
    },
    disconnectRackCable(id) {
      commit(new DeleteRackCableCommand(id));
      history.commitCoalesceBoundary();
    },
    rackCablesAll() {
      return [...model.rackCables.values()];
    },
    getRackCable(id) {
      return model.rackCables.get(id);
    },
    pruneInterfaceCables(deviceId, validIfaceIds) {
      const existing = [...model.rackCables.values()];
      const pruned = pruneCablesForInterfaces(existing, deviceId, validIfaceIds);
      const removed = existing.filter((c) => !pruned.some((p) => p.id === c.id));
      if (removed.length === 0) return;
      // One undoable transaction so a port-set change + its cable cleanup undo together.
      commit(
        transaction(
          'Prune orphaned cables',
          removed.map((c) => new DeleteRackCableCommand(c.id)),
        ),
      );
      history.commitCoalesceBoundary();
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
      for (const o of model.objects.values()) {
        if (o.kind === 'text' && o.rackScope) continue; // lives on a rack elevation
        includeBox(o.x, o.y, o.width, o.height);
      }
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
