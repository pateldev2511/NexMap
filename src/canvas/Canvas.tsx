import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DeviceType } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import { useProjectStore, type AlignEdge, type ProjectStore } from '@/store/projectStore';
import { CanvasSearch } from './CanvasSearch';
import { MiniMap } from './MiniMap';
import { getConnectMode, getWheelAction } from '@/lib/prefs';
import { SelectionToolbar, ToolbarSep } from '@/ui/SelectionToolbar';
import { placeToolbar } from '@/ui/toolbarPlace';
import { normalizeWheel, resolveWheel, MomentumGuard } from '@/input/wheel';
import { keyboardRouter } from '@/input/router';
import { markGestureComplete } from '@/input/quiet';
import {
  reduce,
  IDLE,
  type MachineState,
  type MachineEvent,
  type Effect as MachineEffect,
  type PointerKind,
} from '@/input/machine';
import { DeviceNode } from './DeviceNode';
import { IsoDeviceNode } from './IsoDeviceNode';
import { DEFAULT_LABEL_HEIGHT } from './nodeCard';
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
  // Swallows inertial trackpad wheel events after an Escape-cancel.
  const momentum = useRef(new MomentumGuard());
  // ── Input-machine adapter ────────────────────────────────────────────────
  // ALL gesture kinds run on the pure machine in src/input/machine.ts; the
  // legacy gesture ref is gone (end of the M1 strangler migration).
  const machine = useRef<MachineState>(IDLE);
  // Previous pan position (incremental viewport deltas between updates).
  const panPrev = useRef({ x: 0, y: 0 });
  // Assigned each render (below, after its dependencies exist) so handlers
  // and the router shim always dispatch with fresh closures.
  const dispatchRef = useRef<
    (e: MachineEvent, mods?: { alt?: boolean; shift?: boolean }) => void
  >(() => {});
  const viewportRef = useRef<Viewport>(initialViewport);
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

  // ── Keyboard: canvas-shortcut stage of the shared router ─────────────────
  // The old window listener, strangler-migrated onto keyboardRouter. Text
  // targets never reach this (the router steps aside for them), and Escape /
  // Cmd+Z during an in-flight gesture is consumed by the router's gesture-
  // cancel stage (cancelActiveGesture below) BEFORE this runs.
  const handleCanvasKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (readOnly) return false; // no keyboard editing in presentation
      const mod = e.metaKey || e.ctrlKey;

      // Viewport + selection shortcuts (viewport lives here in the canvas).
      if (mod && e.key === '0') {
        e.preventDefault();
        const cb = store().contentBounds();
        setViewport(
          fitToBox(projection === 'iso' ? projectFlatBox(cb) : cb, size.w, size.h),
        );
        return true;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setViewport((v) => zoomAt(v, 1.2, size.w / 2, size.h / 2));
        return true;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        setViewport((v) => zoomAt(v, 1 / 1.2, size.w / 2, size.h / 2));
        return true;
      }
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        store().selectAll();
        return true;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        store().duplicateSelection();
        store().runValidation();
        return true;
      }
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        store().copySelection();
        return true;
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        store().cutSelection();
        store().runValidation();
        return true;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        store().paste();
        store().runValidation();
        return true;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) store().ungroupSelection();
        else store().groupSelection();
        return true;
      }
      if (mod && e.key === ']') {
        e.preventDefault();
        store().bringForward();
        return true;
      }
      if (mod && e.key === '[') {
        e.preventDefault();
        store().sendBackward();
        return true;
      }
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        return true;
      }
      if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        store().autoLayout();
        return true;
      }
      if (mod) return false; // other mod combos → the app-level stage

      // Zoom to fit the current selection.
      if (e.key === '2' && store().selection.size > 0) {
        e.preventDefault();
        const b = selectionBounds(store());
        if (b)
          setViewport(
            fitToBox(projection === 'iso' ? projectFlatBox(b) : b, size.w, size.h),
          );
        return true;
      }

      // Arrow-key nudge: 1px, or one grid step with Shift (DA-DES — keyboard move).
      if (e.key.startsWith('Arrow') && store().selection.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 16 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store().nudgeSelection(dx, dy);
        return true;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceHeld(true);
        return true;
      }
      if (e.key === 'Alt') {
        altHeld.current = true;
        return false; // modifier tracking only — never consume Alt
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store().deleteSelection();
        store().runValidation();
        return true;
      }
      if (e.key === 'v' || e.key === 'V') return store().setMode('select'), true;
      if (e.key === 'q' || e.key === 'Q') return store().setMode('lasso'), true;
      if (e.key === 'h' || e.key === 'H') return store().setMode('pan'), true;
      if (e.key === 't' || e.key === 'T') return store().setMode('text'), true;
      if (e.key === 'r' || e.key === 'R') return store().setMode('shape'), true;
      if (e.key === 'c' || e.key === 'C' || e.key === 'l' || e.key === 'L')
        return store().setMode('connect'), true;
      if (e.key === 'Escape') {
        // Innermost-only (behavior change 3): any in-flight gesture was
        // already cancelled by the router before this stage. One layer per
        // press: armed visuals / pending click-connect → tool mode →
        // selection. Never all at once.
        momentum.current.block(performance.now()); // eat the trackpad tail
        if (marquee || lassoPts || pendingSourceRef.current) {
          setMarquee(null);
          setLassoPts(null);
          setPending(null);
          return true;
        }
        if (store().mode !== 'select') {
          store().setMode('select');
          return true;
        }
        if (store().selection.size > 0) {
          store().clearSelection();
          return true;
        }
        return false;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, size, readOnly, projection, marquee, lassoPts],
  );

  // Gesture-cancel shim over the legacy gesture ref: reverts whatever is in
  // flight WITHOUT touching history (store.cancelDrag/cancelResize), so the
  // router can consume Escape / Cmd+Z safely mid-gesture. Each per-gesture
  // machine migration swaps its case here for the machine path.
  const cancelActiveGesture = useCallback(() => {
    momentum.current.block(performance.now());
    // ALL gestures are machine-owned: cancel through the reducer — its
    // effects restore the store and release capture.
    if (machine.current.phase !== 'idle') dispatchRef.current({ type: 'escape' });
  }, []);

  // Register with the router. The ref indirection keeps registration stable
  // across renders (and StrictMode-idempotent) while handlers stay fresh.
  const routerApiRef = useRef({ key: handleCanvasKey, cancel: cancelActiveGesture });
  routerApiRef.current = { key: handleCanvasKey, cancel: cancelActiveGesture };
  useEffect(
    () =>
      keyboardRouter.registerCanvas('flat', {
        cancelActiveGesture: () => routerApiRef.current.cancel(),
        hasActiveGesture: () => machine.current.phase !== 'idle',
        handleKey: (e) => routerApiRef.current.key(e),
        handleKeyUp: (e) => {
          if (e.code === 'Space') setSpaceHeld(false);
          if (e.key === 'Alt') altHeld.current = false;
        },
      }),
    [],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Floating chrome (toolbar, zoom bar, minimap, search) owns its own
      // scroll — never pan the canvas underneath it, never preventDefault.
      if (e.target instanceof Element && e.target.closest('[data-canvas-chrome]')) return;
      e.preventDefault();
      const n = normalizeWheel(e);
      // Inertial trackpad tail after an Escape-cancel is not user intent.
      if (momentum.current.shouldSwallow(n.dy, e.timeStamp)) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const intent = resolveWheel(n, getWheelAction());
      if (intent.kind === 'zoom') setViewport((v) => zoomAt(v, intent.factor, sx, sy));
      else setViewport((v) => pan(v, intent.dx, intent.dy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Safari emits proprietary gesture events for trackpad pinch (no
    // ctrlKey-wheel synthesis); map the scale ratio onto cursor-anchored zoom.
    type GestureEvt = Event & { scale?: number; clientX?: number; clientY?: number };
    let lastScale = 1;
    const gestureStart = (e: GestureEvt) => {
      e.preventDefault();
      lastScale = e.scale ?? 1;
    };
    const gestureChange = (e: GestureEvt) => {
      e.preventDefault();
      const scale = e.scale ?? 1;
      const rect = el.getBoundingClientRect();
      const sx = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
      const sy = (e.clientY ?? rect.top + rect.height / 2) - rect.top;
      const factor = scale / (lastScale || 1);
      lastScale = scale;
      setViewport((v) => zoomAt(v, factor, sx, sy));
    };
    const gestureEnd = (e: GestureEvt) => {
      e.preventDefault();
      lastScale = 1;
    };
    el.addEventListener('gesturestart', gestureStart as EventListener);
    el.addEventListener('gesturechange', gestureChange as EventListener);
    el.addEventListener('gestureend', gestureEnd as EventListener);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', gestureStart as EventListener);
      el.removeEventListener('gesturechange', gestureChange as EventListener);
      el.removeEventListener('gestureend', gestureEnd as EventListener);
    };
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

  // ── Machine dispatch + per-gesture effect table (strangler) ─────────────
  // The reducer owns lifecycle (capture, threshold, cancellation, second-
  // pointer policy); these handlers own the store semantics per gesture.
  viewportRef.current = viewport;
  const runMachineEffect = (ef: MachineEffect): void => {
    switch (ef.kind) {
      case 'capture':
        capturePointer(svgRef.current, ef.pointerId);
        break;
      case 'release':
        try {
          svgRef.current?.releasePointerCapture?.(ef.pointerId);
        } catch {
          /* not captured here — fine */
        }
        break;
      case 'begin':
        if (ef.gesture === 'drag') {
          store().beginDrag();
        } else if (ef.gesture === 'resize') {
          store().beginResize((ef.data as { id: string }).id);
        } else if (ef.gesture === 'pan') {
          panPrev.current = { x: ef.x, y: ef.y };
        }
        break;
      case 'update':
        if (ef.gesture === 'drag') {
          const scale = viewportRef.current.scale;
          const d = toFlatVec(ef.dx / scale, ef.dy / scale);
          store().dragTo(d.x, d.y, ef.alt, scale);
          const firstId = [...store().selection][0];
          const m = firstId
            ? (store().getDevice(firstId) ?? store().getObject(firstId))
            : undefined;
          if (m)
            setReadout({ sx: ef.x, sy: ef.y, text: `${Math.round(m.x)}, ${Math.round(m.y)}` });
        } else if (ef.gesture === 'marquee' || ef.gesture === 'shape') {
          setMarquee({
            x: Math.min(ef.startX, ef.x),
            y: Math.min(ef.startY, ef.y),
            w: Math.abs(ef.x - ef.startX),
            h: Math.abs(ef.y - ef.startY),
          });
        } else if (ef.gesture === 'lasso') {
          setLassoPts((prev) => (prev ? [...prev, { x: ef.x, y: ef.y }] : [{ x: ef.x, y: ef.y }]));
        } else if (ef.gesture === 'link' || ef.gesture === 'relink') {
          const c = toFlat(ef.x, ef.y);
          setLinkCursor(c);
          const excl =
            ef.gesture === 'link'
              ? (ef.data as { sourceId: string }).sourceId
              : (ef.data as { otherId: string }).otherId;
          const hit = store().hitTest(c.x, c.y);
          const target = hit.find((id) => id !== excl && store().getDevice(id));
          setLinkTarget(target ?? null);
        } else if (ef.gesture === 'pan') {
          const prev = panPrev.current;
          panPrev.current = { x: ef.x, y: ef.y };
          setViewport((v) => pan(v, -(ef.x - prev.x), -(ef.y - prev.y)));
        } else if (ef.gesture === 'resize') {
          const d = ef.data as {
            id: string;
            handle: Handle;
            orig: { x: number; y: number; width: number; height: number };
          };
          const c = toFlat(ef.x, ef.y);
          const box = resizeBox(d.orig, d.handle, c.x, c.y, (v) => snap(v, ef.alt));
          store().resizeTo(box);
          setReadout({
            sx: ef.x,
            sy: ef.y,
            text: `${Math.round(box.width)} × ${Math.round(box.height)}`,
          });
        } else if (ef.gesture === 'waypoint') {
          const d = ef.data as {
            linkId: string;
            index: number;
            origBefore: { x: number; y: number }[];
          };
          const c = toFlat(ef.x, ef.y);
          const wps = [...(store().getLink(d.linkId)?.waypoints ?? [])];
          wps[d.index] = { x: c.x, y: c.y };
          store().updateLink(d.linkId, { waypoints: d.origBefore }, { waypoints: wps });
        }
        break;
      case 'commit':
        markGestureComplete(); // earned quiet (M3c)
        if (ef.gesture === 'drag') {
          store().endDrag();
          store().runValidation();
          setReadout(null);
        } else if (ef.gesture === 'marquee') {
          const d = ef.data as { additive: boolean; startX: number; startY: number };
          const rect = {
            x: Math.min(d.startX, ef.x),
            y: Math.min(d.startY, ef.y),
            w: Math.abs(ef.x - d.startX),
            h: Math.abs(ef.y - d.startY),
          };
          if (rect.w > 2 || rect.h > 2) {
            // Project all four screen corners so iso marquees cover correctly.
            store().boxSelect(flatBoxFromScreenRect(rect, toFlat), d.additive);
          } else if (!d.additive) {
            store().clearSelection();
          }
          setMarquee(null);
        } else if (ef.gesture === 'lasso') {
          const d = ef.data as { additive: boolean };
          if (lassoPts && lassoPts.length >= 3) {
            store().lassoSelect(
              lassoPts.map((p) => toFlat(p.x, p.y)),
              d.additive,
            );
          }
          setLassoPts(null);
        } else if (ef.gesture === 'shape') {
          const d = ef.data as { startX: number; startY: number };
          const rect = {
            x: Math.min(d.startX, ef.x),
            y: Math.min(d.startY, ef.y),
            w: Math.abs(ef.x - d.startX),
            h: Math.abs(ef.y - d.startY),
          };
          const fb = flatBoxFromScreenRect(rect, toFlat);
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
        } else if (ef.gesture === 'link') {
          // Release: connect on a valid target (drag mode), else arm
          // click-to-connect per the connect-mode preference.
          const d = ef.data as { sourceId: string };
          const target = linkTarget;
          setLinkCursor(null);
          setLinkTarget(null);
          const cm = getConnectMode();
          if (cm !== 'click' && target && target !== d.sourceId) {
            const id = store().connect(d.sourceId, target);
            if (id) {
              store().select([id]);
              store().runValidation();
            }
            setPending(null);
          } else if (cm !== 'drag') {
            setPending(d.sourceId);
          } else {
            setPending(null);
          }
        } else if (ef.gesture === 'relink') {
          const d = ef.data as {
            linkId: string;
            endpoint: 'source' | 'target';
            otherId: string;
          };
          const target = linkTarget;
          setLinkCursor(null);
          setLinkTarget(null);
          // Drop on a valid device → re-wire; drop in air or on the other
          // endpoint (relinkEndpoint rejects self-loop) → snap back.
          if (target) store().relinkEndpoint(d.linkId, d.endpoint, target);
        } else if (ef.gesture === 'pan') {
          const d = ef.data as { button: number; startX: number; startY: number };
          // A right-drag that actually panned must not pop the context menu.
          if (d.button === 2 && Math.hypot(ef.x - d.startX, ef.y - d.startY) > 2) {
            suppressMenu.current = true;
          }
        } else if (ef.gesture === 'resize') {
          store().endResize();
          setReadout(null);
        } else if (ef.gesture === 'waypoint') {
          store().endEdit();
        }
        break;
      case 'cancel':
        if (ef.gesture === 'drag') {
          store().cancelDrag();
          setReadout(null);
        } else if (ef.gesture === 'marquee' || ef.gesture === 'shape') {
          setMarquee(null);
        } else if (ef.gesture === 'lasso') {
          setLassoPts(null);
        } else if (ef.gesture === 'link' || ef.gesture === 'relink') {
          setLinkCursor(null);
          setLinkTarget(null);
        } else if (ef.gesture === 'resize') {
          store().cancelResize();
          setReadout(null);
        } else if (ef.gesture === 'waypoint') {
          const d = ef.data as {
            linkId: string;
            origBefore: { x: number; y: number }[];
          };
          // Restore the pre-drag bends; the live drag coalesced into one
          // history entry, so this collapses it to an identity update.
          const cur = store().getLink(d.linkId)?.waypoints ?? [];
          store().updateLink(
            d.linkId,
            { waypoints: cur },
            { waypoints: d.origBefore },
          );
        }
        break;
      case 'click':
        if (ef.gesture === 'drag') {
          // A press that never crossed the threshold: selection resolves on
          // release (isolate / shift-toggle), unchanged semantics.
          const s = store();
          const pc = ef.data as { members: string[]; shift: boolean; addedOnDown: boolean };
          if (pc.shift) {
            if (!pc.addedOnDown) {
              const next = new Set(s.selection);
              for (const m of pc.members) next.delete(m);
              s.select([...next], false);
            }
          } else {
            s.select(pc.members, false);
          }
          setReadout(null);
        } else if (ef.gesture === 'marquee') {
          // Unmoved press on empty canvas = plain click → deselect on release.
          const d = ef.data as { additive: boolean };
          if (!d.additive) store().clearSelection();
          setMarquee(null);
        } else if (ef.gesture === 'shape') {
          // Tiny press → a default-sized zone at the press point.
          const c = toFlat(ef.x, ef.y);
          const id = store().addShape(snap(c.x, false), snap(c.y, false), 160, 100);
          store().select([id]);
          store().setMode('select');
          setMarquee(null);
        }
        break;
      case 'pinchStart':
        break; // stateless — every update carries prev + next finger points
      case 'pinchUpdate': {
        // Two-finger touch: centroid delta pans, distance ratio zooms at the
        // centroid — one composed viewport write per event (M4a).
        const cx = (ef.a.x + ef.b.x) / 2;
        const cy = (ef.a.y + ef.b.y) / 2;
        const pcx = (ef.prevA.x + ef.prevB.x) / 2;
        const pcy = (ef.prevA.y + ef.prevB.y) / 2;
        const dist = Math.hypot(ef.a.x - ef.b.x, ef.a.y - ef.b.y);
        const prevDist = Math.hypot(ef.prevA.x - ef.prevB.x, ef.prevA.y - ef.prevB.y);
        // Touch points update in ALTERNATING events, so a straight two-finger
        // pan oscillates the distance slightly — a 1% deadband keeps pans
        // from creeping the zoom while real pinches (>1%/event) pass through.
        const ratio = prevDist > 0 ? dist / prevDist : 1;
        const zooming = Math.abs(ratio - 1) > 0.01;
        setViewport((v) => {
          const panned = pan(v, -(cx - pcx), -(cy - pcy));
          return zooming ? zoomAt(panned, ratio, cx, cy) : panned;
        });
        break;
      }
      case 'pinchEnd':
        markGestureComplete();
        break;
      default:
        break; // swallowClick (flat svg has no click listener to swallow)
    }
  };
  dispatchRef.current = (e: MachineEvent, mods?: { alt?: boolean; shift?: boolean }) => {
    const r = reduce(machine.current, e, mods);
    machine.current = r.state;
    for (const ef of r.effects) runMachineEffect(ef);
  };

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

  const startLinkFrom = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      // MIGRATED: link rubber-band runs on the input machine, immediate arm
      // (the band starts at press — no threshold).
      const { sx, sy } = localPoint(e);
      setLinkCursor(toFlat(sx, sy));
      setLinkTarget(null);
      dispatchRef.current({
        type: 'arm',
        gesture: 'link',
        data: { sourceId: id },
        immediate: true,
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: sx,
        y: sy,
      });
    },
    // toFlat carries BOTH viewport and projection — depending on viewport
    // alone left a stale projection in this closure after a flat↔iso toggle
    // (drops/link starts landed at mis-projected coordinates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toFlat],
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
      const otherId = endpoint === 'source' ? link.targetId : link.sourceId;
      const { sx, sy } = localPoint(e);
      setLinkCursor(toFlat(sx, sy));
      setLinkTarget(null);
      dispatchRef.current({
        type: 'arm',
        gesture: 'relink',
        data: { linkId, endpoint, otherId },
        immediate: true,
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: sx,
        y: sy,
      });
    },
    // toFlat, not viewport: see startLinkFrom (stale-projection fix).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toFlat, store],
  );

  const armWaypoint = useCallback(
    (
      e: React.PointerEvent,
      linkId: string,
      index: number,
      origBefore: { x: number; y: number }[],
    ) => {
      const { sx, sy } = localPoint(e);
      dispatchRef.current({
        type: 'arm',
        gesture: 'waypoint',
        data: { linkId, index, origBefore },
        immediate: true, // bends track the pointer from the press
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: sx,
        y: sy,
      });
    },
    [localPoint],
  );

  const onWaypointDown = useCallback(
    (e: React.PointerEvent, linkId: string, index: number) => {
      e.stopPropagation();
      const link = store().getLink(linkId);
      armWaypoint(e, linkId, index, [...(link?.waypoints ?? [])]);
    },
    [store, armWaypoint],
  );

  const onAddWaypoint = useCallback(
    (
      e: React.PointerEvent,
      linkId: string,
      segIndex: number,
      point: { x: number; y: number },
    ) => {
      e.stopPropagation();
      const before = [...(store().getLink(linkId)?.waypoints ?? [])];
      const after = [...before];
      after.splice(segIndex, 0, { x: point.x, y: point.y });
      store().updateLink(linkId, { waypoints: before }, { waypoints: after });
      armWaypoint(e, linkId, segIndex, before);
    },
    [store, armWaypoint],
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
      const o = store().getObject(id);
      if (!o) return;
      const { sx, sy } = localPoint(e);
      dispatchRef.current({
        type: 'arm',
        gesture: 'resize',
        data: { id, handle, orig: { x: o.x, y: o.y, width: o.width, height: o.height } },
        immediate: true, // handles track from the press
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: sx,
        y: sy,
      });
    },
    [store, localPoint],
  );

  const onDevicePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      // A second pointer while the machine owns a gesture → its policy
      // (touch cancels into pinch; mouse/pen buttons are ignored).
      if (machine.current.phase !== 'idle') {
        e.stopPropagation();
        const { sx, sy } = localPoint(e);
        dispatchRef.current({
          type: 'down',
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: sx,
          y: sy,
        });
        return;
      }
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
      // MIGRATED: drag runs on the input machine — capture, the 4px
      // threshold, buttons validation, and cancellation are all owned there.
      const { sx, sy } = localPoint(e);
      dispatchRef.current({
        type: 'arm',
        gesture: 'drag',
        data: { members, shift: e.shiftKey, addedOnDown },
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: sx,
        y: sy,
      });
    },
    [spaceHeld, store, localPoint, startLinkFrom, setPending, readOnly],
  );

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { sx, sy } = localPoint(e);
      // Machine-owned gesture in flight → second-pointer policy, never a
      // parallel legacy gesture.
      if (machine.current.phase !== 'idle') {
        dispatchRef.current({
          type: 'down',
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: sx,
          y: sy,
        });
        return;
      }
      // Pan with: Space-held, middle button, right button (draw.io), or Hand
      // tool. MIGRATED: pan runs on the machine (immediate arm — it starts at
      // press; the machine's capture effect targets the svg, which is what
      // keeps move/up firing off-element).
      if (
        readOnly ||
        spaceHeld ||
        e.button === 1 ||
        e.button === 2 ||
        store().mode === 'pan'
      ) {
        dispatchRef.current({
          type: 'arm',
          gesture: 'pan',
          data: { button: e.button, startX: sx, startY: sy },
          immediate: true,
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: sx,
          y: sy,
        });
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
      // MIGRATED: shape / lasso / marquee run on the input machine.
      if (store().mode === 'shape') {
        setMarquee({ x: sx, y: sy, w: 0, h: 0 });
        dispatchRef.current({
          type: 'arm',
          gesture: 'shape',
          data: { startX: sx, startY: sy },
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: sx,
          y: sy,
        });
        return;
      }
      if (store().mode === 'lasso') {
        setLassoPts([{ x: sx, y: sy }]);
        dispatchRef.current({
          type: 'arm',
          gesture: 'lasso',
          data: { additive: e.shiftKey },
          immediate: true, // a lasso accumulates from the very first point
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: sx,
          y: sy,
        });
        return;
      }
      // Deselection resolves on RELEASE (like device clicks): a committed
      // marquee replaces the selection via boxSelect, an unmoved click
      // clears it via the machine's click effect, and an Escape-cancelled
      // marquee leaves the existing selection untouched (behavior change 3).
      setMarquee({ x: sx, y: sy, w: 0, h: 0 });
      dispatchRef.current({
        type: 'arm',
        gesture: 'marquee',
        data: { additive: e.shiftKey, startX: sx, startY: sy },
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: sx,
        y: sy,
      });
    },
    [spaceHeld, store, localPoint, readOnly, toFlat],
  );

  // Keyboard selection: Tab focuses a device node, Enter/Space selects it.
  const onActivateNode = useCallback((id: string) => store().select([id]), [store]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (machine.current.phase !== 'idle') {
        const { sx, sy } = localPoint(e);
        dispatchRef.current(
          { type: 'move', pointerId: e.pointerId, buttons: e.buttons, x: sx, y: sy },
          { alt: altHeld.current, shift: e.shiftKey },
        );
        return;
      }
      // All gesture kinds are machine-owned (dispatch guard above).
      // Idle: track hovered device so the connect handle can appear.
      const { sx, sy } = localPoint(e);
      const canvasPt = toFlat(sx, sy);
      const hit = store().hitTest(canvasPt.x, canvasPt.y);
      const top = hit.find((id) => store().getDevice(id)) ?? null;
      if (top !== hoveredId) setHoveredId(top);
    },
    [store, localPoint, viewport, hoveredId, toFlat, toFlatVec],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (machine.current.phase !== 'idle') {
        dispatchRef.current({ type: 'up', pointerId: e.pointerId }, { shift: e.shiftKey });
        return;
      }
      // All gesture kinds commit through the machine's effect table. A
      // machine-idle release is just a stray up: release capture defensively.
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* not captured here — fine */
      }
      setReadout(null);
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
    // toFlat, not viewport: see startLinkFrom (stale-projection fix).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, toFlat],
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
    // Margin keeps just-off-screen content mounted so panning doesn't pop nodes
    // in at the edges. Iso needs more headroom (the projection skews bounds).
    const m = projection === 'iso' ? 200 : 96;
    return { x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m };
  })();
  const vis = (layerId: string) => store().isLayerVisible(layerId);
  const devices = (size.w > 0 ? store().visibleDevices(box) : []).filter((d) =>
    vis(d.layerId),
  );
  // Stacking order: lower z renders first (underneath).
  devices.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  // Cull objects (shapes/zones/text/underlays) to the viewport too — large
  // diagrams with many annotations no longer render the off-screen ones.
  const allObjects = (size.w > 0 ? store().visibleObjects(box) : []).filter((o) =>
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
  // Link/relink live on the machine now; every band update sets linkCursor
  // state, so this render always sees the machine's current gesture.
  const linkSource =
    machine.current.gesture === 'link'
      ? store().getDevice((machine.current.data as { sourceId: string }).sourceId)
      : machine.current.gesture === 'relink'
        ? // anchor the rubber at the FIXED endpoint
          store().getDevice((machine.current.data as { otherId: string }).otherId)
        : undefined;

  // While a link is selected its relink endpoint handles own the device edges, so the
  // hover connect-ports yield to avoid overlapping click targets (eng-review lock).
  const anyLinkSelected = [...selection].some((id) => !!store().getLink(id));


  // One-shot tilt flourish when the projection (flat ↔ iso) flips.
  const [flipping, setFlipping] = useState(false);
  const prevProjection = useRef(projection);
  useEffect(() => {
    if (prevProjection.current === projection) return;
    prevProjection.current = projection;
    setFlipping(true);
    const t = setTimeout(() => setFlipping(false), 300);
    return () => clearTimeout(t);
  }, [projection]);

  const svgClass = `${styles.svg} ${
    machine.current.gesture === 'pan' && machine.current.phase !== 'idle'
      ? styles.panning
      : spaceHeld || mode === 'pan'
        ? styles.panMode
        : mode === 'connect' || mode === 'lasso'
          ? styles.connectMode
          : ''
  }${flipping ? ' ' + styles.flip : ''}`;
  const gridStep = 16 * viewport.scale;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-canvas-surface
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
        onPointerCancel={cancelActiveGesture}
        onLostPointerCapture={() => {
          // A capture we lose without a pointerup is a cancelled gesture
          // (OS interrupt, element churn). pointerup fires lostpointercapture
          // too, but by then the up handler already reset gesture to 'none',
          // so this is a no-op on the normal path.
          if (machine.current.phase !== 'idle') cancelActiveGesture();
        }}
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
          {/* ISO stage: a soft floor vignette so the iso view reads as a lit scene. */}
          <radialGradient id="nexmap-iso-stage" cx="50%" cy="40%" r="80%">
            <stop offset="0%" stopColor="#8aa0c8" stopOpacity={0} />
            <stop offset="100%" stopColor="#1e293b" stopOpacity={0.17} />
          </radialGradient>
        </defs>
        {projection !== 'iso' ? (
          <rect x={0} y={0} width="100%" height="100%" fill="url(#nexmap-grid)" />
        ) : (
          <rect x={0} y={0} width="100%" height="100%" fill="url(#nexmap-iso-stage)" />
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
                {projection === 'iso' && (
                  <path
                    className={styles.linkShadow}
                    d={d}
                    style={{ strokeWidth: stroke.width + 3 }}
                  />
                )}
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
                onActivate={onActivateNode}
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
            machine.current.phase === 'idle' &&
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
                  onActivate={onActivateNode}
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
              machine.current.phase === 'idle' &&
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

      {/* Floating selection toolbar (M3): the PRIMARY quick-action path.
          Hidden while a gesture is active — contextual chrome that follows a
          drag is noise at the exact moment the user needs the canvas. */}
      {!readOnly &&
        selection.size > 0 &&
        machine.current.phase !== 'active' &&
        machine.current.phase !== 'pinch' &&
        (() => {
          const b = selectionBounds(store());
          if (!b) return null;
          const fb = projection === 'iso' ? projectFlatBox(b) : b;
          const tl = canvasToScreen(viewport, fb.x, fb.y);
          const br = canvasToScreen(viewport, fb.x + fb.width, fb.y + fb.height);
          const first = [...selection][0]!;
          return (
            <FlatSelectionToolbar
              bbox={{ x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y }}
              vw={size.w}
              vh={size.h}
              cardAbove={selection.size === 1 && !!store().getDevice(first)}
              selCount={selection.size}
              movableCount={movableSelCount}
              canUngroup={[...selection].some((id) => store().groupMembers(id).length > 1)}
            />
          );
        })()}

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

      <div className={styles.zoomBar} data-canvas-chrome data-demote="chrome">
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
          // Lift the inline rename box up to where the floating info card sits, so
          // double-clicking the card name pops the editor right at the card.
          const lh = d.labelHeight ?? DEFAULT_LABEL_HEIGHT;
          const top = p.y - lh * viewport.scale - 24;
          return (
            <input
              autoFocus
              className={styles.textEditor}
              defaultValue={d.name}
              style={{ left: p.x - 70, top, width: 140, textAlign: 'center' }}
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
/**
 * Flat-canvas selection toolbar content (M3). Button-matrix rule: buttons
 * never appear/disappear per selection — inapplicable actions DISABLE, so
 * the toolbar width is stable for the flat selection type.
 * (AlignBar is absorbed here; its fixed top-center slot is deleted.)
 */
function FlatSelectionToolbar({
  bbox,
  vw,
  vh,
  cardAbove,
  selCount,
  movableCount,
  canUngroup,
}: {
  bbox: { x: number; y: number; width: number; height: number };
  vw: number;
  vh: number;
  cardAbove: boolean;
  selCount: number;
  movableCount: number;
  canUngroup: boolean;
}) {
  const store = useProjectStore.getState;
  const [size, setSize] = useState({ width: 340, height: 36 });
  const pos = placeToolbar(bbox, size, { width: vw, height: vh }, cardAbove);
  const align = (edge: AlignEdge) => store().alignSelection(edge);
  const dist = (axis: 'h' | 'v') => store().distributeSelection(axis);
  const canAlign = movableCount >= 2;
  const canDist = movableCount >= 3;
  const icon = (
    title: string,
    name: Parameters<typeof NexIcon>[0]['name'],
    onClick: () => void,
    disabled = false,
  ) => (
    <button title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <NexIcon name={name} />
    </button>
  );
  return (
    <SelectionToolbar
      left={pos.left}
      top={pos.top}
      label="Selection actions"
      barRef={(el) => {
        if (
          el &&
          (Math.abs(el.offsetWidth - size.width) > 1 ||
            Math.abs(el.offsetHeight - size.height) > 1)
        ) {
          setSize({ width: el.offsetWidth, height: el.offsetHeight });
        }
      }}
    >
      {icon('Align left', 'align-left', () => align('left'), !canAlign)}
      {icon('Align horizontal centers', 'align-hcenter', () => align('hcenter'), !canAlign)}
      {icon('Align right', 'align-right', () => align('right'), !canAlign)}
      {icon('Align top', 'align-top', () => align('top'), !canAlign)}
      {icon('Align vertical centers', 'align-vcenter', () => align('vcenter'), !canAlign)}
      {icon('Align bottom', 'align-bottom', () => align('bottom'), !canAlign)}
      {icon('Distribute horizontally', 'distribute-h', () => dist('h'), !canDist)}
      {icon('Distribute vertically', 'distribute-v', () => dist('v'), !canDist)}
      <ToolbarSep />
      {icon('Group', 'group', () => store().groupSelection(), selCount < 2)}
      {icon('Ungroup', 'ungroup', () => store().ungroupSelection(), !canUngroup)}
      <ToolbarSep />
      {icon('Bring forward', 'bring-forward', () => store().bringForward())}
      {icon('Send backward', 'send-backward', () => store().sendBackward())}
      <ToolbarSep />
      {icon('Delete selection', 'trash', () => {
        store().deleteSelection();
        store().runValidation();
      })}
    </SelectionToolbar>
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

