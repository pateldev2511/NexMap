import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DeviceType } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import { useProjectStore, type AlignEdge, type ProjectStore } from '@/store/projectStore';
import { CanvasSearch } from './CanvasSearch';
import { MiniMap } from './MiniMap';
import { getConnectMode } from '@/lib/prefs';
import { DeviceNode } from './DeviceNode';
import { IsoDeviceNode } from './IsoDeviceNode';
import { IsoTextNode } from './IsoTextNode';
import { ObjectNode } from './ObjectNode';
import { CanvasToolbar } from './CanvasToolbar';
import {
  connectorIconPoints,
  parallelIconPoints,
  orthogonalIconPoints,
  center,
  iconEdgePoint,
  pairKey,
  alongFrom,
  pathD,
  segmentMidpoints,
  labelAnchor,
  connectorLabelLines,
  deriveLinkStroke,
} from './connector';
import { ContextMenu, type MenuItem } from './ContextMenu';
import {
  canvasToScreen,
  fitToBox,
  GRID_SIZE,
  initialViewport,
  pan,
  screenToCanvas,
  snap,
  visibleBox,
  zoomAt,
  type Viewport,
} from './viewport';
import { isoProjectPx, isoUnprojectPx, type IsoTile } from './iso';
import type { Box } from '@/lib/spatial-index';
import styles from './Canvas.module.css';

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; lastX: number; lastY: number; button: number; moved: boolean }
  | {
      kind: 'drag';
      startX: number;
      startY: number;
      /** True once movement crossed the threshold and a real drag began. */
      moved: boolean;
      /** Deferred click resolution if the press never becomes a drag. */
      pending: { members: string[]; shift: boolean; addedOnDown: boolean };
    }
  | { kind: 'marquee'; startX: number; startY: number; additive: boolean }
  | { kind: 'lasso'; additive: boolean }
  | { kind: 'shape'; startX: number; startY: number }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      orig: { x: number; y: number; width: number; height: number };
    }
  | { kind: 'link'; sourceId: string }
  | { kind: 'relink'; linkId: string; endpoint: 'source' | 'target'; otherId: string }
  | {
      kind: 'waypoint';
      linkId: string;
      index: number;
      origBefore: { x: number; y: number }[];
    };

const ZOOM_STEP = 1.0015;
/** Pointer travel (screen px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * Capture the pointer on the SVG (which owns the move/up handlers) so a gesture
 * keeps tracking even if the cursor leaves the element. Capturing the parent div
 * instead would drop the svg from the event path and silently break drag-panning,
 * marquee, resize, and link rubber-banding. Wrapped because setPointerCapture
 * throws on an already-released pointer.
 */
function capturePointer(el: Element | null, pointerId: number): void {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* pointer already gone — fine */
  }
}

interface CanvasProps {
  /** Presentation/read-only: pan+zoom only, no editing chrome. */
  readOnly?: boolean;
  /** Overlay printable page boundaries. */
  showPages?: boolean;
}

const PAGE = { w: 1123, h: 794 }; // A4 landscape @96dpi, in canvas units

// Isometric tile (Phase 9): one 16px flat cell → a 32×16 diamond (true 2:1).
const ISO_TILE: IsoTile = { w: 32, h: 16 };
// SVG affine matrix that maps flat pixel coords into iso screen space. Because
// the iso projection is linear, the whole flat scene projects via one matrix.
const ISO_A = ISO_TILE.w / (2 * GRID_SIZE);
const ISO_B = ISO_TILE.h / (2 * GRID_SIZE);
const ISO_MATRIX = `matrix(${ISO_A} ${ISO_B} ${-ISO_A} ${ISO_B} 0 0)`;
// Inverse of the iso linear matrix. Wrapping a text element at flat anchor (ax,ay)
// in `translate(ax ay) ISO_COUNTER translate(-ax -ay)` cancels the group shear, so
// the glyphs render UPRIGHT while staying pinned to their projected position.
const ISO_COUNTER = `matrix(${1 / (2 * ISO_A)} ${-1 / (2 * ISO_A)} ${1 / (2 * ISO_B)} ${1 / (2 * ISO_B)} 0 0)`;
function isoUprightTransform(ax: number, ay: number): string {
  return `translate(${ax} ${ay}) ${ISO_COUNTER} translate(${-ax} ${-ay})`;
}

/** Flat bounding box covering a screen-space rectangle's four corners. */
function flatBoxFromScreenRect(
  m: { x: number; y: number; w: number; h: number },
  toFlat: (sx: number, sy: number) => { x: number; y: number },
): Box {
  const pts = [
    toFlat(m.x, m.y),
    toFlat(m.x + m.w, m.y),
    toFlat(m.x, m.y + m.h),
    toFlat(m.x + m.w, m.y + m.h),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Bounding box (in iso screen space) of a flat box's four projected corners. */
function projectFlatBox(b: Box): Box {
  const corners = [
    isoProjectPx(b.x, b.y, GRID_SIZE, ISO_TILE),
    isoProjectPx(b.x + b.width, b.y, GRID_SIZE, ISO_TILE),
    isoProjectPx(b.x, b.y + b.height, GRID_SIZE, ISO_TILE),
    isoProjectPx(b.x + b.width, b.y + b.height, GRID_SIZE, ISO_TILE),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function Canvas({ readOnly = false, showPages = false }: CanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [marquee, setMarquee] = useState<null | {
    x: number;
    y: number;
    w: number;
    h: number;
  }>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(
    null,
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ sx: number; sy: number; text: string } | null>(
    null,
  );
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lassoPts, setLassoPts] = useState<{ x: number; y: number }[] | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const pendingSourceRef = useRef<string | null>(null);
  const gesture = useRef<Gesture>({ kind: 'none' });
  const altHeld = useRef(false);
  // Set after a right-button drag-pan so the trailing contextmenu is suppressed.
  const suppressMenu = useRef(false);

  const setPending = useCallback((id: string | null) => {
    pendingSourceRef.current = id;
    setPendingSource(id);
  }, []);

  const rev = useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const mode = useProjectStore((s) => s.mode);
  const projection = useProjectStore((s) => s.projection);
  const issues = useProjectStore((s) => s.issues);
  const focusTick = useProjectStore((s) => s.focusTick);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const cameraTick = useProjectStore((s) => s.cameraTick);
  const health = useProjectStore((s) => s.health);
  const store = useProjectStore.getState;

  // Report the camera so views can capture it; restore it when a view is applied.
  useEffect(() => {
    store().reportCamera(viewport);
  }, [viewport, store]);
  useEffect(() => {
    if (cameraTick === 0) return;
    const c = store().cameraRequest();
    if (c) setViewport(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraTick]);

  // Center on a device when jump-to-object fires (validation/inventory click).
  useEffect(() => {
    if (focusTick === 0) return;
    const id = store().focusTarget;
    const d = id ? store().getDevice(id) : undefined;
    const o = id ? store().getObject(id) : undefined;
    const target = d ?? o;
    if (!target || size.w === 0) return;
    setViewport((v) => {
      const scale = Math.max(v.scale, 0.75);
      const cx = target.x + target.width / 2;
      const cy = target.y + target.height / 2;
      const p =
        projection === 'iso'
          ? isoProjectPx(cx, cy, GRID_SIZE, ISO_TILE)
          : { x: cx, y: cy };
      return { scale, tx: size.w / 2 - p.x * scale, ty: size.h / 2 - p.y * scale };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  // Object IDs carrying an error/critical issue → canvas badge.
  const errorIds = new Set<string>();
  for (const i of issues) {
    if (i.severity === 'error' || i.severity === 'critical') {
      for (const id of i.objectIds) errorIds.add(id);
    }
  }

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTextTarget(e.target) || readOnly) return; // no keyboard editing in presentation
      const mod = e.metaKey || e.ctrlKey;

      // Viewport + selection shortcuts (viewport lives here in the canvas).
      if (mod && e.key === '0') {
        e.preventDefault();
        const cb = store().contentBounds();
        setViewport(
          fitToBox(projection === 'iso' ? projectFlatBox(cb) : cb, size.w, size.h),
        );
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setViewport((v) => zoomAt(v, 1.2, size.w / 2, size.h / 2));
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        setViewport((v) => zoomAt(v, 1 / 1.2, size.w / 2, size.h / 2));
        return;
      }
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        store().selectAll();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        store().duplicateSelection();
        store().runValidation();
        return;
      }
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        store().copySelection();
        return;
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        store().cutSelection();
        store().runValidation();
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        store().paste();
        store().runValidation();
        return;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) store().ungroupSelection();
        else store().groupSelection();
        return;
      }
      if (mod && e.key === ']') {
        e.preventDefault();
        store().bringForward();
        return;
      }
      if (mod && e.key === '[') {
        e.preventDefault();
        store().sendBackward();
        return;
      }
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        store().autoLayout();
        return;
      }
      if (mod) return; // leave other mod combos to the app-level handler

      // Zoom to fit the current selection.
      if (e.key === '2' && store().selection.size > 0) {
        e.preventDefault();
        const b = selectionBounds(store());
        if (b)
          setViewport(
            fitToBox(projection === 'iso' ? projectFlatBox(b) : b, size.w, size.h),
          );
        return;
      }

      // Arrow-key nudge: 1px, or one grid step with Shift (DA-DES — keyboard move).
      if (e.key.startsWith('Arrow') && store().selection.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 16 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store().nudgeSelection(dx, dy);
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.key === 'Alt') altHeld.current = true;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store().deleteSelection();
        store().runValidation();
      }
      if (e.key === 'v' || e.key === 'V') store().setMode('select');
      if (e.key === 'q' || e.key === 'Q') store().setMode('lasso');
      if (e.key === 'h' || e.key === 'H') store().setMode('pan');
      if (e.key === 't' || e.key === 'T') store().setMode('text');
      if (e.key === 'r' || e.key === 'R') store().setMode('shape');
      if (e.key === 'c' || e.key === 'C' || e.key === 'l' || e.key === 'L')
        store().setMode('connect');
      if (e.key === 'Escape') {
        if (gesture.current.kind === 'link' || gesture.current.kind === 'relink') cancelLink();
        gesture.current = { kind: 'none' };
        setMarquee(null);
        setLassoPts(null);
        setPending(null);
        store().setMode('select');
        store().clearSelection();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
      if (e.key === 'Alt') altHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // Re-bind when size/projection change so Cmd+0/zoom use current dimensions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, size, readOnly, projection]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        setViewport((v) => zoomAt(v, Math.pow(ZOOM_STEP, -e.deltaY), sx, sy));
      } else {
        setViewport((v) => pan(v, e.deltaX, e.deltaY));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const localPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = rootRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }, []);

  // Screen pixel → FLAT model coordinate (projection-aware). In iso mode the
  // pointer lands in iso screen space, so we invert the projection too.
  const toFlat = useCallback(
    (sx: number, sy: number): { x: number; y: number } => {
      const c = screenToCanvas(viewport, sx, sy);
      return projection === 'iso' ? isoUnprojectPx(c.x, c.y, GRID_SIZE, ISO_TILE) : c;
    },
    [viewport, projection],
  );

  // Screen-space delta (already divided by scale) → FLAT delta. The projection is
  // linear, so the same inverse applies to vectors (no translation).
  const toFlatVec = useCallback(
    (dx: number, dy: number): { x: number; y: number } =>
      projection === 'iso'
        ? isoUnprojectPx(dx, dy, GRID_SIZE, ISO_TILE)
        : { x: dx, y: dy },
    [projection],
  );

  // Fit a flat box into view, projecting it first when isometric.
  const fitFlatBox = useCallback(
    (flatBox: Box) => {
      const box = projection === 'iso' ? projectFlatBox(flatBox) : flatBox;
      setViewport(fitToBox(box, size.w, size.h));
    },
    [projection, size],
  );

  const zoomToSelection = useCallback(() => {
    const b = selectionBounds(useProjectStore.getState());
    if (b) fitFlatBox(b);
  }, [fitFlatBox]);

  function cancelLink() {
    gesture.current = { kind: 'none' };
    setLinkCursor(null);
    setLinkTarget(null);
  }

  const startLinkFrom = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      capturePointer(svgRef.current, e.pointerId);
      gesture.current = { kind: 'link', sourceId: id };
      const c = screenToCanvasFromEvent(e);
      setLinkCursor(c);
      setLinkTarget(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewport],
  );

  function screenToCanvasFromEvent(e: { clientX: number; clientY: number }) {
    const { sx, sy } = localPoint(e);
    return toFlat(sx, sy);
  }

  /** Begin dragging one END of an existing link to re-wire it (drag-to-relink). */
  const startRelink = useCallback(
    (e: React.PointerEvent, linkId: string, endpoint: 'source' | 'target') => {
      e.stopPropagation();
      const link = store().getLink(linkId);
      if (!link) return;
      capturePointer(svgRef.current, e.pointerId);
      const otherId = endpoint === 'source' ? link.targetId : link.sourceId;
      gesture.current = { kind: 'relink', linkId, endpoint, otherId };
      setLinkCursor(screenToCanvasFromEvent(e));
      setLinkTarget(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewport],
  );

  const onWaypointDown = useCallback(
    (e: React.PointerEvent, linkId: string, index: number) => {
      e.stopPropagation();
      capturePointer(svgRef.current, e.pointerId);
      const link = store().getLink(linkId);
      gesture.current = {
        kind: 'waypoint',
        linkId,
        index,
        origBefore: [...(link?.waypoints ?? [])],
      };
    },
    [store],
  );

  const onAddWaypoint = useCallback(
    (
      e: React.PointerEvent,
      linkId: string,
      segIndex: number,
      point: { x: number; y: number },
    ) => {
      e.stopPropagation();
      capturePointer(svgRef.current, e.pointerId);
      const before = [...(store().getLink(linkId)?.waypoints ?? [])];
      const after = [...before];
      after.splice(segIndex, 0, { x: point.x, y: point.y });
      store().updateLink(linkId, { waypoints: before }, { waypoints: after });
      gesture.current = { kind: 'waypoint', linkId, index: segIndex, origBefore: before };
    },
    [store],
  );

  const onRemoveWaypoint = useCallback(
    (linkId: string, index: number) => {
      const before = [...(store().getLink(linkId)?.waypoints ?? [])];
      store().updateLink(
        linkId,
        { waypoints: before },
        { waypoints: before.filter((_, i) => i !== index) },
      );
      store().endEdit();
    },
    [store],
  );

  const onResizeHandleDown = useCallback(
    (e: React.PointerEvent, id: string, handle: Handle) => {
      e.stopPropagation();
      capturePointer(svgRef.current, e.pointerId);
      const o = store().getObject(id);
      if (!o) return;
      store().beginResize(id);
      gesture.current = {
        kind: 'resize',
        id,
        handle,
        orig: { x: o.x, y: o.y, width: o.width, height: o.height },
      };
    },
    [store],
  );

  const onDevicePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      // Only the left button selects/drags a cell. Middle/right bubble to the
      // root so they pan (draw.io: right-drag pans anywhere) or open the menu.
      if (e.button !== 0) return;
      if (readOnly || spaceHeld || store().mode === 'pan') return; // let the root handler pan
      // In connect mode, pressing a DEVICE starts a link drag (not objects).
      if (store().mode === 'connect') {
        if (!store().getDevice(id)) return;
        // Click-to-connect: a second click on a different device completes the link.
        const pending = pendingSourceRef.current;
        if (pending && pending !== id) {
          const lid = store().connect(pending, id);
          if (lid) {
            store().select([lid]);
            store().runValidation();
          }
          setPending(null);
          return;
        }
        startLinkFrom(e, id);
        return;
      }
      e.stopPropagation();
      capturePointer(svgRef.current, e.pointerId);
      const s = store();
      // Clicking a grouped device selects the whole group (Phase 1 grouping).
      const members = s.groupMembers(id);
      const already = s.selection.has(id);
      // Selection commits on RELEASE for clicks (so a click can isolate one of a
      // multi-selection, and shift-click can toggle off). On press we only make
      // the minimal change needed so a subsequent drag moves the right things.
      let addedOnDown = false;
      if (e.shiftKey) {
        if (!already) {
          s.select(members, true); // add to selection (lets you drag it immediately)
          addedOnDown = true;
        }
      } else if (!already) {
        s.select(members, false); // select just this (group)
      }
      // NOTE: beginDrag is deferred until movement crosses DRAG_THRESHOLD.
      const { sx, sy } = localPoint(e);
      gesture.current = {
        kind: 'drag',
        startX: sx,
        startY: sy,
        moved: false,
        pending: { members, shift: e.shiftKey, addedOnDown },
      };
    },
    [spaceHeld, store, localPoint, startLinkFrom, setPending, readOnly],
  );

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { sx, sy } = localPoint(e);
      // Capture on the SVG (where the move/up handlers live) so they keep firing
      // during a pan — capturing the parent div would exclude the svg from the
      // event path and silently break drag-panning.
      capturePointer(svgRef.current, e.pointerId);
      // Pan with: Space-held, middle button, right button (draw.io), or Hand tool.
      if (
        readOnly ||
        spaceHeld ||
        e.button === 1 ||
        e.button === 2 ||
        store().mode === 'pan'
      ) {
        gesture.current = {
          kind: 'pan',
          lastX: e.clientX,
          lastY: e.clientY,
          button: e.button,
          moved: false,
        };
        return;
      }
      if (e.button !== 0) return; // any other non-left press: ignore
      if (store().mode === 'connect') return; // empty press in connect mode = noop
      if (store().mode === 'text') {
        const c = toFlat(sx, sy);
        const id = store().addText(snap(c.x, false), snap(c.y, false));
        store().select([id]);
        store().setMode('select');
        setEditingTextId(id);
        return;
      }
      if (store().mode === 'shape') {
        gesture.current = { kind: 'shape', startX: sx, startY: sy };
        setMarquee({ x: sx, y: sy, w: 0, h: 0 });
        return;
      }
      if (store().mode === 'lasso') {
        gesture.current = { kind: 'lasso', additive: e.shiftKey };
        setLassoPts([{ x: sx, y: sy }]);
        return;
      }
      if (!e.shiftKey) store().clearSelection();
      gesture.current = { kind: 'marquee', startX: sx, startY: sy, additive: e.shiftKey };
      setMarquee({ x: sx, y: sy, w: 0, h: 0 });
    },
    [spaceHeld, store, localPoint, readOnly, toFlat],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (g.kind === 'pan') {
        setViewport((v) => pan(v, -(e.clientX - g.lastX), -(e.clientY - g.lastY)));
        gesture.current = { ...g, lastX: e.clientX, lastY: e.clientY, moved: true };
        return;
      }
      const { sx, sy } = localPoint(e);
      const canvasPt = toFlat(sx, sy);

      if (g.kind === 'link') {
        setLinkCursor(canvasPt);
        const hit = store().hitTest(canvasPt.x, canvasPt.y);
        const target = hit.find((id) => id !== g.sourceId && store().getDevice(id));
        setLinkTarget(target ?? null);
        return;
      }
      if (g.kind === 'relink') {
        setLinkCursor(canvasPt);
        const hit = store().hitTest(canvasPt.x, canvasPt.y);
        const target = hit.find((id) => id !== g.otherId && store().getDevice(id));
        setLinkTarget(target ?? null);
        return;
      }
      if (g.kind === 'waypoint') {
        const wps = [...(store().getLink(g.linkId)?.waypoints ?? [])];
        wps[g.index] = { x: canvasPt.x, y: canvasPt.y };
        store().updateLink(g.linkId, { waypoints: g.origBefore }, { waypoints: wps });
        return;
      }
      if (g.kind === 'resize') {
        const box = resizeBox(g.orig, g.handle, canvasPt.x, canvasPt.y, (v) =>
          snap(v, altHeld.current),
        );
        store().resizeTo(box);
        setReadout({
          sx,
          sy,
          text: `${Math.round(box.width)} × ${Math.round(box.height)}`,
        });
        return;
      }
      if (g.kind === 'drag') {
        // Below threshold this is still a click — don't move anything yet.
        if (!g.moved) {
          if (Math.hypot(sx - g.startX, sy - g.startY) < DRAG_THRESHOLD) return;
          store().beginDrag(); // snapshot origins now that a real drag starts
          g.moved = true;
          gesture.current = g;
        }
        const d = toFlatVec(
          (sx - g.startX) / viewport.scale,
          (sy - g.startY) / viewport.scale,
        );
        store().dragTo(d.x, d.y, altHeld.current, viewport.scale);
        const firstId = [...store().selection][0];
        const m = firstId
          ? (store().getDevice(firstId) ?? store().getObject(firstId))
          : undefined;
        if (m) setReadout({ sx, sy, text: `${Math.round(m.x)}, ${Math.round(m.y)}` });
        return;
      }
      if (g.kind === 'marquee' || g.kind === 'shape') {
        setMarquee({
          x: Math.min(g.startX, sx),
          y: Math.min(g.startY, sy),
          w: Math.abs(sx - g.startX),
          h: Math.abs(sy - g.startY),
        });
        return;
      }
      if (g.kind === 'lasso') {
        setLassoPts((pts) => (pts ? [...pts, { x: sx, y: sy }] : [{ x: sx, y: sy }]));
        return;
      }
      // Idle: track hovered device so the connect handle can appear.
      const hit = store().hitTest(canvasPt.x, canvasPt.y);
      const top = hit.find((id) => store().getDevice(id)) ?? null;
      if (top !== hoveredId) setHoveredId(top);
    },
    [store, localPoint, viewport, hoveredId, toFlat, toFlatVec],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      gesture.current = { kind: 'none' };
      // Pointer capture auto-releases on pointerup; release defensively in case
      // it was taken on the svg (pan) or a child (drag), ignoring if neither.
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* not captured here — fine */
      }
      setReadout(null);
      if (g.kind === 'pan') {
        // A right-drag that actually panned should not pop the context menu.
        if (g.button === 2 && g.moved) suppressMenu.current = true;
        return;
      }
      if (g.kind === 'waypoint') {
        store().endEdit();
        return;
      }
      if (g.kind === 'resize') {
        store().endResize();
        return;
      }
      if (g.kind === 'drag') {
        if (g.moved) {
          store().endDrag();
          store().runValidation();
        } else {
          // A click (no drag): resolve selection on release.
          const s = store();
          const pc = g.pending;
          if (pc.shift) {
            if (!pc.addedOnDown) {
              // Shift-click an already-selected item → toggle it off.
              const next = new Set(s.selection);
              for (const m of pc.members) next.delete(m);
              s.select([...next], false);
            }
          } else {
            // Plain click → isolate this item/group (collapse any multi-selection).
            s.select(pc.members, false);
          }
        }
      } else if (g.kind === 'link') {
        const target = linkTarget;
        cancelLink();
        const cm = getConnectMode();
        if (cm !== 'click' && target && target !== g.sourceId) {
          // Drag-to-connect (allowed in 'both' and 'drag').
          const id = store().connect(g.sourceId, target);
          if (id) {
            store().select([id]);
            store().runValidation();
          }
          setPending(null);
        } else if (cm !== 'drag') {
          // Arm click-to-connect (allowed in 'both' and 'click').
          setPending(g.sourceId);
        } else {
          setPending(null);
        }
      } else if (g.kind === 'relink') {
        const target = linkTarget;
        cancelLink();
        // Drop on a valid device → re-wire; drop in air or on the other endpoint
        // (relinkEndpoint rejects self-loop) → snap back, no change.
        if (target) store().relinkEndpoint(g.linkId, g.endpoint, target);
      } else if (g.kind === 'marquee' && marquee) {
        // Project all four screen corners to flat so iso marquees cover correctly.
        const fb = flatBoxFromScreenRect(marquee, toFlat);
        if (marquee.w > 2 || marquee.h > 2) {
          store().boxSelect(fb, g.additive);
        }
        setMarquee(null);
      } else if (g.kind === 'lasso') {
        if (lassoPts && lassoPts.length >= 3) {
          const poly = lassoPts.map((p) => toFlat(p.x, p.y));
          store().lassoSelect(poly, g.additive);
        }
        setLassoPts(null);
      } else if (g.kind === 'shape' && marquee) {
        const fb = flatBoxFromScreenRect(marquee, toFlat);
        // Tiny drag → a default-sized zone at the press point.
        const id =
          fb.width > 8 && fb.height > 8
            ? store().addShape(
                snap(fb.x, false),
                snap(fb.y, false),
                Math.round(fb.width),
                Math.round(fb.height),
              )
            : store().addShape(snap(fb.x, false), snap(fb.y, false), 160, 100);
        store().select([id]);
        store().setMode('select');
        setMarquee(null);
      }
    },
    [store, marquee, linkTarget, lassoPts, setPending, toFlat],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const type = e.dataTransfer.getData('application/nexmap-device') as DeviceType;
      if (!type) return;
      const c = screenToCanvasFromEvent(e);
      const x = snap(c.x - 28, altHeld.current);
      const y = snap(c.y - 20, altHeld.current);
      const s = store();
      const id = s.addDeviceAt(type, x, y);
      s.select([id]);
      s.runValidation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, viewport],
  );

  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      const { sx, sy } = localPoint(e);
      const c = toFlat(sx, sy);
      const id = store()
        .hitTest(c.x, c.y)
        .find((id) => store().getObject(id)?.kind === 'text');
      if (id) {
        store().select([id]);
        setEditingTextId(id);
      }
    },
    [store, localPoint, toFlat, readOnly],
  );

  const commitDeviceName = useCallback(
    (id: string, name: string) => {
      const d = store().getDevice(id);
      const trimmed = name.trim();
      if (d && trimmed && trimmed !== d.name) {
        store().updateDevice(id, { name: d.name }, { name: trimmed });
        store().endEdit();
        store().runValidation();
      }
      setEditingDeviceId(null);
    },
    [store],
  );

  const commitText = useCallback(
    (id: string, text: string) => {
      const o = store().getObject(id);
      if (o && o.kind === 'text' && text !== o.text) {
        store().updateObject(id, { text: o.text }, { text });
        store().endEdit();
      }
      setEditingTextId(null);
    },
    [store],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (readOnly) return;
      // Suppress the menu if this contextmenu is the tail of a right-drag pan.
      if (suppressMenu.current) {
        suppressMenu.current = false;
        return;
      }
      const { sx, sy } = localPoint(e);
      const c = toFlat(sx, sy);
      const hitId = store()
        .hitTest(c.x, c.y)
        .find((id) => store().getDevice(id) || store().getObject(id));
      const s = store();
      if (hitId && !s.selection.has(hitId)) s.select([hitId]);
      const onEntity = !!hitId;
      const locked = hitId ? !!(s.getDevice(hitId) ?? s.getObject(hitId))?.locked : false;

      const items: MenuItem[] = onEntity
        ? [
            { label: 'Copy', shortcut: '⌘C', onClick: () => s.copySelection() },
            {
              label: 'Cut',
              shortcut: '⌘X',
              onClick: () => {
                s.cutSelection();
                s.runValidation();
              },
            },
            {
              label: 'Duplicate',
              shortcut: '⌘D',
              onClick: () => {
                s.duplicateSelection();
                s.runValidation();
              },
            },
            {
              label: 'Paste',
              shortcut: '⌘V',
              onClick: () => {
                s.paste();
                s.runValidation();
              },
              disabled: !s.hasClipboard(),
            },
            {
              label: 'Bring to front',
              onClick: () => s.bringToFront(),
              separatorBefore: true,
            },
            { label: 'Send to back', onClick: () => s.sendToBack() },
            {
              label: 'Group',
              shortcut: '⌘G',
              onClick: () => s.groupSelection(),
              separatorBefore: true,
              disabled: s.selection.size < 2,
            },
            { label: 'Ungroup', shortcut: '⌘⇧G', onClick: () => s.ungroupSelection() },
            {
              label: locked ? 'Unlock' : 'Lock',
              onClick: () => s.toggleLockSelection(),
              separatorBefore: true,
            },
            {
              label: 'Delete',
              shortcut: '⌫',
              onClick: () => {
                s.deleteSelection();
                s.runValidation();
              },
            },
          ]
        : [
            {
              label: 'Paste',
              shortcut: '⌘V',
              onClick: () => {
                s.paste();
                s.runValidation();
              },
              disabled: !s.hasClipboard(),
            },
            {
              label: 'Select all',
              shortcut: '⌘A',
              onClick: () => s.selectAll(),
              separatorBefore: true,
            },
          ];
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [store, localPoint, toFlat, readOnly],
  );

  void rev;
  // Cull box in FLAT space. In iso the visible flat region is the inverse-
  // projected screen rect, not the axis-aligned visibleBox; a margin keeps
  // edge-straddling tiles drawn.
  const box = (() => {
    const b =
      projection === 'iso' && size.w > 0
        ? flatBoxFromScreenRect({ x: 0, y: 0, w: size.w, h: size.h }, toFlat)
        : visibleBox(viewport, size.w, size.h);
    const m = projection === 'iso' ? 200 : 0;
    return { x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m };
  })();
  const vis = (layerId: string) => store().isLayerVisible(layerId);
  const devices = (size.w > 0 ? store().visibleDevices(box) : []).filter((d) =>
    vis(d.layerId),
  );
  // Stacking order: lower z renders first (underneath).
  devices.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const allObjects = (size.w > 0 ? store().objectsAll() : []).filter((o) =>
    vis(o.layerId),
  );
  const byZ = (a: { z?: number }, b: { z?: number }) => (a.z ?? 0) - (b.z ?? 0);
  const images = allObjects.filter((o) => o.kind === 'image').sort(byZ); // back-most underlays
  const shapes = allObjects.filter((o) => o.kind === 'shape').sort(byZ); // render under links
  const texts = allObjects.filter((o) => o.kind === 'text').sort(byZ); // render on top
  const links = (size.w > 0 ? store().visibleLinks(box) : []).filter((l) =>
    vis(l.layerId),
  );
  // Group parallel links (same device pair) so they fan out instead of overlapping.
  const linkGroups = new Map<string, string[]>();
  for (const l of links) {
    const k = pairKey(l);
    (linkGroups.get(k) ?? linkGroups.set(k, []).get(k)!).push(l.id);
  }
  const guides = store().alignGuides();
  const movableSelCount = [...selection].filter(
    (id) => store().getDevice(id) || store().getObject(id),
  ).length;
  const handleDevice = hoveredId ? store().getDevice(hoveredId) : undefined;
  const linkSource =
    gesture.current.kind === 'link'
      ? store().getDevice(gesture.current.sourceId)
      : gesture.current.kind === 'relink'
        ? store().getDevice(gesture.current.otherId) // anchor rubber at the FIXED endpoint
        : undefined;

  // While a link is selected its relink endpoint handles own the device edges, so the
  // hover connect-ports yield to avoid overlapping click targets (eng-review lock).
  const anyLinkSelected = [...selection].some((id) => !!store().getLink(id));


  const svgClass = `${styles.svg} ${
    gesture.current.kind === 'pan'
      ? styles.panning
      : spaceHeld || mode === 'pan'
        ? styles.panMode
        : mode === 'connect' || mode === 'lasso'
          ? styles.connectMode
          : ''
  }`;
  const gridStep = 16 * viewport.scale;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className={svgClass}
        onPointerDown={onRootPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoveredId(null)}
        onDoubleClick={onCanvasDoubleClick}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern
            id="nexmap-grid"
            width={gridStep}
            height={gridStep}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${viewport.tx} ${viewport.ty})`}
          >
            <circle
              cx={0}
              cy={0}
              r={Math.max(0.5, viewport.scale)}
              fill="var(--canvas-grid)"
            />
          </pattern>
          <marker
            id="nexmap-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--chrome-fg-muted)" />
          </marker>
        </defs>
        {projection !== 'iso' && (
          <rect x={0} y={0} width="100%" height="100%" fill="url(#nexmap-grid)" />
        )}

        <g
          transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})${
            projection === 'iso' ? ' ' + ISO_MATRIX : ''
          }`}
        >
          {projection === 'iso' && size.w > 0 && (
            <IsoGrid
              flat={flatBoxFromScreenRect({ x: 0, y: 0, w: size.w, h: size.h }, toFlat)}
            />
          )}
          {showPages && <PageBoundaries content={store().contentBounds()} />}
          {images.map((o) => (
            <ObjectNode
              key={o.id}
              object={o}
              selected={selection.has(o.id)}
              onPointerDown={onDevicePointerDown}
            />
          ))}
          {shapes.map((o) => (
            <ObjectNode
              key={o.id}
              object={o}
              selected={selection.has(o.id)}
              onPointerDown={onDevicePointerDown}
              labelUpright={projection === 'iso' ? isoUprightTransform : undefined}
            />
          ))}
          {links.map((l) => {
            const a = store().getDevice(l.sourceId);
            const b = store().getDevice(l.targetId);
            if (!a || !b) return null;
            const group = linkGroups.get(pairKey(l)) ?? [l.id];
            const noWp = (l.waypoints?.length ?? 0) === 0;
            const pts =
              l.routing === 'orthogonal' && noWp
                ? orthogonalIconPoints(a, b)
                : parallelIconPoints(l, a, b, group.indexOf(l.id), group.length);
            const d = pathD(pts);
            const sel = selection.has(l.id);
            const stroke = deriveLinkStroke(l, health, group.length === 1);
            const labelLines = connectorLabelLines(l);
            const lblAt = labelLines.length ? labelAnchor(pts) : null;
            const arrow = l.arrow ?? 'end';
            const first = pts[0]!;
            const last = pts[pts.length - 1]!;
            const srcLbl = l.sourceInterface ? alongFrom(first, pts[1]!, 24) : null;
            const tgtLbl = l.targetInterface
              ? alongFrom(last, pts[pts.length - 2]!, 24)
              : null;
            return (
              <g key={l.id}>
                <path
                  className={styles.linkHit}
                  d={d}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return; // let right/middle pan
                    if (store().mode === 'connect') return;
                    e.stopPropagation();
                    store().select([l.id], e.shiftKey);
                  }}
                />
                <path
                  className={`${styles.link} ${sel ? styles.selected : ''}`}
                  d={d}
                  style={{
                    // inline beats the CSS class `stroke`; selection still wins visually.
                    // null color → omit so the theme-aware CSS class default applies.
                    stroke: sel ? 'var(--accent)' : (stroke.color ?? undefined),
                    strokeWidth: sel ? Math.max(stroke.width, 2.5) : stroke.width,
                  }}
                  strokeDasharray={stroke.dashed ? '6 4' : undefined}
                  markerEnd={
                    arrow === 'end' || arrow === 'both' ? 'url(#nexmap-arrow)' : undefined
                  }
                  markerStart={arrow === 'both' ? 'url(#nexmap-arrow)' : undefined}
                />
                {sel &&
                  !readOnly &&
                  ([
                    ['source', first, pts[1] ?? last] as const,
                    ['target', last, pts[pts.length - 2] ?? first] as const,
                  ]).map(([end, anchor, toward]) => {
                    const p = alongFrom(anchor, toward, 14 / viewport.scale);
                    const s = 5 / viewport.scale;
                    return (
                      <rect
                        key={end}
                        className={styles.relinkHandle}
                        x={p.x - s}
                        y={p.y - s}
                        width={s * 2}
                        height={s * 2}
                        transform={`rotate(45 ${p.x} ${p.y})`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          startRelink(e, l.id, end);
                        }}
                      />
                    );
                  })}
                {lblAt && (
                  <text
                    className={styles.linkLabel}
                    x={lblAt.x}
                    y={lblAt.y - 4 - (labelLines.length - 1) * 11}
                    transform={
                      projection === 'iso'
                        ? isoUprightTransform(lblAt.x, lblAt.y)
                        : undefined
                    }
                  >
                    {labelLines.map((line, i) => (
                      <tspan key={i} x={lblAt.x} dy={i === 0 ? 0 : 11}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                )}
                {srcLbl && (
                  <text
                    className={styles.ifaceLabel}
                    x={srcLbl.x}
                    y={srcLbl.y}
                    transform={
                      projection === 'iso'
                        ? isoUprightTransform(srcLbl.x, srcLbl.y)
                        : undefined
                    }
                  >
                    {l.sourceInterface}
                  </text>
                )}
                {tgtLbl && (
                  <text
                    className={styles.ifaceLabel}
                    x={tgtLbl.x}
                    y={tgtLbl.y}
                    transform={
                      projection === 'iso'
                        ? isoUprightTransform(tgtLbl.x, tgtLbl.y)
                        : undefined
                    }
                  >
                    {l.targetInterface}
                  </text>
                )}
              </g>
            );
          })}

          {/* Reroute handles for the single selected connector. */}
          {(() => {
            if (readOnly || selection.size !== 1) return null;
            const id = [...selection][0]!;
            const link = store().getLink(id);
            if (!link) return null;
            const a = store().getDevice(link.sourceId);
            const b = store().getDevice(link.targetId);
            if (!a || !b) return null;
            const pts = connectorIconPoints(link, a, b);
            const wps = link.waypoints ?? [];
            const r = 5 / viewport.scale;
            return (
              <g>
                {segmentMidpoints(pts).map((m, i) => (
                  <circle
                    key={`add-${i}`}
                    className={styles.addWaypoint}
                    cx={m.x}
                    cy={m.y}
                    r={r}
                    onPointerDown={(e) => onAddWaypoint(e, id, i, m)}
                  />
                ))}
                {wps.map((w, i) => (
                  <circle
                    key={`wp-${i}`}
                    className={styles.waypoint}
                    cx={w.x}
                    cy={w.y}
                    r={r * 1.3}
                    onPointerDown={(e) => onWaypointDown(e, id, i)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onRemoveWaypoint(id, i);
                    }}
                  />
                ))}
              </g>
            );
          })()}

          {/* Resize handles for the single selected canvas object. */}
          {(() => {
            if (readOnly || selection.size !== 1) return null;
            const id = [...selection][0]!;
            const o = store().getObject(id);
            if (!o || o.locked) return null;
            // Text renders upright in iso; its sheared handles would mismatch.
            if (projection === 'iso' && o.kind === 'text') return null;
            const hs = 4 / viewport.scale;
            return (
              <g>
                {HANDLES.map((h) => {
                  const p = handlePoint(o, h);
                  return (
                    <rect
                      key={h}
                      className={styles.resizeHandle}
                      x={p.x - hs}
                      y={p.y - hs}
                      width={hs * 2}
                      height={hs * 2}
                      style={{ cursor: HANDLE_CURSOR[h] }}
                      onPointerDown={(e) => onResizeHandleDown(e, id, h)}
                    />
                  );
                })}
              </g>
            );
          })()}

          {/* Rubber-band while connecting. */}
          {linkSource &&
            linkCursor &&
            (() => {
              const start = iconEdgePoint(linkSource, linkCursor);
              return (
                <line
                  className={styles.rubber}
                  x1={start.x}
                  y1={start.y}
                  x2={linkCursor.x}
                  y2={linkCursor.y}
                />
              );
            })()}

          {projection !== 'iso' &&
            devices.map((dev) => (
              <DeviceNode
                key={dev.id}
                device={dev}
                selected={selection.has(dev.id)}
                scale={viewport.scale}
                validTarget={linkTarget === dev.id || pendingSource === dev.id}
                hasIssue={errorIds.has(dev.id)}
                onPointerDown={onDevicePointerDown}
                onLabelDoubleClick={(e, id) => {
                  e.stopPropagation();
                  if (!readOnly) setEditingDeviceId(id);
                }}
              />
            ))}

          {projection !== 'iso' &&
            texts.map((o) => (
              <ObjectNode
                key={o.id}
                object={o}
                selected={selection.has(o.id)}
                onPointerDown={onDevicePointerDown}
              />
            ))}

          {/* Smart alignment guides during a drag. */}
          {guides.map((gd, i) =>
            gd.axis === 'x' ? (
              <line
                key={`guide-${i}`}
                className={styles.alignGuide}
                x1={gd.pos}
                y1={gd.start}
                x2={gd.pos}
                y2={gd.end}
                strokeWidth={1 / viewport.scale}
              />
            ) : (
              <line
                key={`guide-${i}`}
                className={styles.alignGuide}
                x1={gd.start}
                y1={gd.pos}
                x2={gd.end}
                y2={gd.pos}
                strokeWidth={1 / viewport.scale}
              />
            ),
          )}

          {/* Directional connect ports on the hovered device (flat mode; iso has its own). */}
          {!readOnly &&
            projection !== 'iso' &&
            mode === 'select' &&
            handleDevice &&
            !anyLinkSelected &&
            gesture.current.kind === 'none' &&
            (() => {
              const c = center(handleDevice);
              const dirs = [
                { x: c.x + 100, y: c.y },
                { x: c.x - 100, y: c.y },
                { x: c.x, y: c.y - 100 },
                { x: c.x, y: c.y + 100 },
              ];
              return dirs.map((to, i) => {
                const h = iconEdgePoint(handleDevice, to);
                return (
                  <circle
                    key={i}
                    className={styles.connectHandle}
                    cx={h.x}
                    cy={h.y}
                    r={5 / viewport.scale}
                    onPointerDown={(e) => startLinkFrom(e, handleDevice.id)}
                  />
                );
              });
            })()}
        </g>

        {/* Upright iso layer (Phase 9.3): device tiles + connect handle, NOT
            sheared by the iso matrix so glyphs/labels stay crisp. */}
        {projection === 'iso' && (
          <g
            transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}
          >
            {[...devices]
              .sort((a, b) => a.x + a.y - (b.x + b.y)) // painter's: far tiles first
              .map((dev) => (
                <IsoDeviceNode
                  key={dev.id}
                  device={dev}
                  selected={selection.has(dev.id)}
                  scale={viewport.scale}
                  gridSize={GRID_SIZE}
                  tile={ISO_TILE}
                  validTarget={linkTarget === dev.id || pendingSource === dev.id}
                  hasIssue={errorIds.has(dev.id)}
                  onPointerDown={onDevicePointerDown}
                  onLabelDoubleClick={(e, id) => {
                    e.stopPropagation();
                    if (!readOnly) setEditingDeviceId(id);
                  }}
                />
              ))}
            {texts.map((o) =>
              o.kind === 'text' ? (
                <IsoTextNode
                  key={o.id}
                  object={o}
                  selected={selection.has(o.id)}
                  gridSize={GRID_SIZE}
                  tile={ISO_TILE}
                  onPointerDown={onDevicePointerDown}
                />
              ) : null,
            )}
            {!readOnly &&
              mode === 'select' &&
              handleDevice &&
              !anyLinkSelected &&
              gesture.current.kind === 'none' &&
              (() => {
                const c = center(handleDevice);
                const dirs = [
                  { x: c.x + 100, y: c.y },
                  { x: c.x - 100, y: c.y },
                  { x: c.x, y: c.y - 100 },
                  { x: c.x, y: c.y + 100 },
                ];
                return dirs.map((to, i) => {
                  const edge = iconEdgePoint(handleDevice, to);
                  const p = isoProjectPx(edge.x, edge.y, GRID_SIZE, ISO_TILE);
                  return (
                    <circle
                      key={i}
                      className={styles.connectHandle}
                      cx={p.x}
                      cy={p.y}
                      r={5 / viewport.scale}
                      onPointerDown={(e) => startLinkFrom(e, handleDevice.id)}
                    />
                  );
                });
              })()}
          </g>
        )}

        {marquee && (
          <rect
            className={styles.marquee}
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
          />
        )}
        {lassoPts && lassoPts.length > 1 && (
          <polygon
            className={styles.marquee}
            points={lassoPts.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        )}
      </svg>

      {!readOnly && movableSelCount >= 2 && <AlignBar count={movableSelCount} />}

      {!readOnly && searchOpen && <CanvasSearch onClose={() => setSearchOpen(false)} />}

      {!readOnly && (
        <CanvasToolbar
          mode={mode}
          onMode={(m) => store().setMode(m)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => {
            store().undo();
            store().runValidation();
          }}
          onRedo={() => {
            store().redo();
            store().runValidation();
          }}
          onHelp={() => window.dispatchEvent(new CustomEvent('nexmap:help'))}
          projection={projection}
          onToggleProjection={() =>
            store().setProjection(projection === 'iso' ? 'flat' : 'iso')
          }
          onAutoLayout={() => store().autoLayout()}
        />
      )}

      <div className={styles.zoomBar}>
        <button
          onClick={() => setViewport((v) => zoomAt(v, 1 / 1.2, size.w / 2, size.h / 2))}
          aria-label="Zoom out"
        >
          <NexIcon name="zoom-out" />
        </button>
        <span className={styles.zoomPct}>{Math.round(viewport.scale * 100)}%</span>
        <button
          onClick={() => setViewport((v) => zoomAt(v, 1.2, size.w / 2, size.h / 2))}
          aria-label="Zoom in"
        >
          <NexIcon name="zoom-in" />
        </button>
        <button
          onClick={() => fitFlatBox(store().contentBounds())}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          <NexIcon name="fit-screen" />
        </button>
        <button
          onClick={zoomToSelection}
          disabled={selection.size === 0}
          aria-label="Zoom to selection"
          title="Zoom to selection (2)"
        >
          <NexIcon name="zoom-selection" />
        </button>
      </div>

      <MiniMap
        viewRect={
          projection === 'flat' && size.w > 0
            ? {
                x: -viewport.tx / viewport.scale,
                y: -viewport.ty / viewport.scale,
                width: size.w / viewport.scale,
                height: size.h / viewport.scale,
              }
            : null
        }
        onJump={(fx, fy) => {
          const p =
            projection === 'iso'
              ? isoProjectPx(fx, fy, GRID_SIZE, ISO_TILE)
              : { x: fx, y: fy };
          setViewport((v) => ({
            ...v,
            tx: size.w / 2 - p.x * v.scale,
            ty: size.h / 2 - p.y * v.scale,
          }));
        }}
      />

      {readout && (
        <div className={styles.dragReadout} style={{ left: readout.sx, top: readout.sy }}>
          {readout.text}
        </div>
      )}

      {editingTextId &&
        (() => {
          const o = store().getObject(editingTextId);
          if (!o || o.kind !== 'text') return null;
          const fp =
            projection === 'iso'
              ? isoProjectPx(o.x, o.y, GRID_SIZE, ISO_TILE)
              : { x: o.x, y: o.y };
          const p = canvasToScreen(viewport, fp.x, fp.y);
          const fs = (o.fontSize ?? 14) * viewport.scale;
          return (
            <textarea
              autoFocus
              className={styles.textEditor}
              defaultValue={o.text}
              style={{
                left: p.x,
                top: p.y,
                width: o.width * viewport.scale,
                height: o.height * viewport.scale,
                fontSize: fs,
                color: o.color ?? 'var(--chrome-fg)',
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitText(editingTextId, e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  setEditingTextId(null);
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText(editingTextId, e.currentTarget.value);
                }
              }}
            />
          );
        })()}

      {editingDeviceId &&
        (() => {
          const d = store().getDevice(editingDeviceId);
          if (!d) return null;
          const fp =
            projection === 'iso'
              ? isoProjectPx(d.x + d.width / 2, d.y, GRID_SIZE, ISO_TILE)
              : { x: d.x + d.width / 2, y: d.y };
          const p = canvasToScreen(viewport, fp.x, fp.y);
          return (
            <input
              autoFocus
              className={styles.textEditor}
              defaultValue={d.name}
              style={{ left: p.x - 70, top: p.y - 24, width: 140, textAlign: 'center' }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitDeviceName(editingDeviceId, e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setEditingDeviceId(null);
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDeviceName(editingDeviceId, e.currentTarget.value);
                }
              }}
            />
          );
        })()}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** Printable A4-landscape page grid overlay covering the content (Phase 5). */
function PageBoundaries({
  content,
}: {
  content: { x: number; y: number; width: number; height: number };
}) {
  const ox = content.width > 0 ? content.x - 40 : 0;
  const oy = content.height > 0 ? content.y - 40 : 0;
  const cols = Math.max(1, Math.ceil((content.width + 80) / PAGE.w));
  const rows = Math.max(1, Math.ceil((content.height + 80) / PAGE.h));
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * PAGE.w;
      const y = oy + r * PAGE.h;
      cells.push(
        <g key={`${r}-${c}`}>
          <rect x={x} y={y} width={PAGE.w} height={PAGE.h} className={styles.pageRect} />
          <text x={x + 8} y={y + 20} className={styles.pageLabel}>
            Page {r * cols + c + 1}
          </text>
        </g>,
      );
    }
  }
  return <g pointerEvents="none">{cells}</g>;
}

/** Floating alignment toolbar shown when 2+ movable entities are selected. */
function AlignBar({ count }: { count: number }) {
  const store = useProjectStore.getState;
  const align = (edge: AlignEdge) => store().alignSelection(edge);
  const dist = (axis: 'h' | 'v') => store().distributeSelection(axis);
  const canDist = count >= 3;
  return (
    <div className={styles.alignBar} role="toolbar" aria-label="Align and distribute">
      <button title="Align left" aria-label="Align left" onClick={() => align('left')}>
        <NexIcon name="align-left" />
      </button>
      <button
        title="Align horizontal centers"
        aria-label="Align horizontal centers"
        onClick={() => align('hcenter')}
      >
        <NexIcon name="align-hcenter" />
      </button>
      <button title="Align right" aria-label="Align right" onClick={() => align('right')}>
        <NexIcon name="align-right" />
      </button>
      <span className={styles.sep} />
      <button title="Align top" aria-label="Align top" onClick={() => align('top')}>
        <NexIcon name="align-top" />
      </button>
      <button
        title="Align vertical centers"
        aria-label="Align vertical centers"
        onClick={() => align('vcenter')}
      >
        <NexIcon name="align-vcenter" />
      </button>
      <button
        title="Align bottom"
        aria-label="Align bottom"
        onClick={() => align('bottom')}
      >
        <NexIcon name="align-bottom" />
      </button>
      <span className={styles.sep} />
      <button
        title="Distribute horizontally"
        aria-label="Distribute horizontally"
        disabled={!canDist}
        onClick={() => dist('h')}
      >
        <NexIcon name="distribute-h" />
      </button>
      <button
        title="Distribute vertically"
        aria-label="Distribute vertically"
        disabled={!canDist}
        onClick={() => dist('v')}
      >
        <NexIcon name="distribute-v" />
      </button>
    </div>
  );
}

/** Isometric lattice: flat grid lines drawn inside the projected group so the
 *  iso matrix shears them into the classic diamond floor. (Phase 9.2) */
function IsoGrid({ flat }: { flat: Box }) {
  let step = GRID_SIZE * 2; // 32px flat cells
  while (flat.width / step > 140 || flat.height / step > 140) step *= 2;
  const x0 = Math.floor(flat.x / step) * step;
  const x1 = Math.ceil((flat.x + flat.width) / step) * step;
  const y0 = Math.floor(flat.y / step) * step;
  const y1 = Math.ceil((flat.y + flat.height) / step) * step;
  const lines: React.ReactNode[] = [];
  for (let x = x0; x <= x1; x += step) {
    lines.push(
      <line
        key={`v${x}`}
        className={styles.isoGridLine}
        x1={x}
        y1={y0}
        x2={x}
        y2={y1}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  for (let y = y0; y <= y1; y += step) {
    lines.push(
      <line
        key={`h${y}`}
        className={styles.isoGridLine}
        x1={x0}
        y1={y}
        x2={x1}
        y2={y}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_OBJ_SIZE = 16;

interface RBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen-pixel cursor for each handle. */
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Canvas position of a resize handle on a box. */
function handlePoint(b: RBox, h: Handle): { x: number; y: number } {
  const midX = b.x + b.width / 2;
  const midY = b.y + b.height / 2;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  switch (h) {
    case 'nw':
      return { x: b.x, y: b.y };
    case 'n':
      return { x: midX, y: b.y };
    case 'ne':
      return { x: right, y: b.y };
    case 'e':
      return { x: right, y: midY };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: midX, y: bottom };
    case 'sw':
      return { x: b.x, y: bottom };
    case 'w':
      return { x: b.x, y: midY };
  }
}

/** New box from dragging a handle to canvas (cx,cy), clamped to a minimum size. */
function resizeBox(
  orig: RBox,
  h: Handle,
  cx: number,
  cy: number,
  snapFn: (v: number) => number,
): RBox {
  let { x, y, width, height } = orig;
  const right = orig.x + orig.width;
  const bottom = orig.y + orig.height;
  if (h === 'w' || h === 'nw' || h === 'sw') {
    const nx = Math.min(snapFn(cx), right - MIN_OBJ_SIZE);
    x = nx;
    width = right - nx;
  }
  if (h === 'e' || h === 'ne' || h === 'se') {
    width = Math.max(MIN_OBJ_SIZE, snapFn(cx) - orig.x);
  }
  if (h === 'n' || h === 'nw' || h === 'ne') {
    const ny = Math.min(snapFn(cy), bottom - MIN_OBJ_SIZE);
    y = ny;
    height = bottom - ny;
  }
  if (h === 's' || h === 'sw' || h === 'se') {
    height = Math.max(MIN_OBJ_SIZE, snapFn(cy) - orig.y);
  }
  return { x, y, width, height };
}

/** Bounding box of the current selection (devices, objects, link endpoints). */
function selectionBounds(s: ProjectStore): RBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const inc = (x: number, y: number, w = 0, h = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const id of s.selection) {
    const d = s.getDevice(id);
    if (d) {
      inc(d.x, d.y, d.width, d.height);
      continue;
    }
    const o = s.getObject(id);
    if (o) {
      inc(o.x, o.y, o.width, o.height);
      continue;
    }
    const l = s.getLink(id);
    if (l) {
      const a = s.getDevice(l.sourceId);
      const b = s.getDevice(l.targetId);
      if (a) inc(a.x, a.y, a.width, a.height);
      if (b) inc(b.x, b.y, b.width, b.height);
      for (const p of l.waypoints ?? []) inc(p.x, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
