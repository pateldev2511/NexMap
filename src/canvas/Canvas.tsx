import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DeviceType } from '@/model/types';
import { useProjectStore } from '@/store/projectStore';
import { DeviceNode } from './DeviceNode';
import {
  fitToBox,
  initialViewport,
  pan,
  screenToCanvas,
  snap,
  visibleBox,
  zoomAt,
  type Viewport,
} from './viewport';
import styles from './Canvas.module.css';

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'drag'; startX: number; startY: number; moved: boolean }
  | { kind: 'marquee'; startX: number; startY: number; additive: boolean };

const ZOOM_STEP = 1.0015; // per wheel-delta unit

export function Canvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [marquee, setMarquee] = useState<null | { x: number; y: number; w: number; h: number }>(
    null,
  );
  const gesture = useRef<Gesture>({ kind: 'none' });
  const altHeld = useRef(false);

  // Subscribe to model changes via rev; read scene through the SceneSource API.
  const rev = useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const store = useProjectStore.getState;

  // Track container size for culling + coordinate math.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Space-to-pan + Alt-to-suspend-snap + delete, at the window level.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTextTarget(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.key === 'Alt') altHeld.current = true;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextTarget(e.target)) {
        e.preventDefault();
        store().deleteSelection();
        store().runValidation();
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
  }, [store]);

  // Wheel: scroll = pan, Cmd/Ctrl+scroll = zoom (cursor-anchored). Non-passive so
  // we can preventDefault the browser's pinch-zoom / page-zoom (DA-DES-5.1).
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

  const localPoint = useCallback((e: React.PointerEvent) => {
    const rect = rootRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }, []);

  const onDevicePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (spaceHeld) return; // let the root handler pan
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const s = store();
      if (!s.selection.has(id)) s.select([id], e.shiftKey);
      else if (e.shiftKey) s.select([id], true);
      s.beginDrag();
      const { sx, sy } = localPoint(e);
      gesture.current = { kind: 'drag', startX: sx, startY: sy, moved: false };
    },
    [spaceHeld, store, localPoint],
  );

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { sx, sy } = localPoint(e);
      rootRef.current!.setPointerCapture(e.pointerId);
      if (spaceHeld || e.button === 1) {
        gesture.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        return;
      }
      // Empty-canvas press → marquee box-select.
      if (!e.shiftKey) store().clearSelection();
      gesture.current = { kind: 'marquee', startX: sx, startY: sy, additive: e.shiftKey };
      setMarquee({ x: sx, y: sy, w: 0, h: 0 });
    },
    [spaceHeld, store, localPoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (g.kind === 'pan') {
        setViewport((v) => pan(v, -(e.clientX - g.lastX), -(e.clientY - g.lastY)));
        gesture.current = { ...g, lastX: e.clientX, lastY: e.clientY };
        return;
      }
      const { sx, sy } = localPoint(e);
      if (g.kind === 'drag') {
        const v = viewport;
        const dx = (sx - g.startX) / v.scale;
        const dy = (sy - g.startY) / v.scale;
        store().dragTo(dx, dy, altHeld.current);
        if (!g.moved) gesture.current = { ...g, moved: true };
        return;
      }
      if (g.kind === 'marquee') {
        setMarquee({
          x: Math.min(g.startX, sx),
          y: Math.min(g.startY, sy),
          w: Math.abs(sx - g.startX),
          h: Math.abs(sy - g.startY),
        });
      }
    },
    [store, localPoint, viewport],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      gesture.current = { kind: 'none' };
      rootRef.current?.releasePointerCapture?.(e.pointerId);
      if (g.kind === 'drag') {
        store().endDrag();
        if (g.moved) store().runValidation();
      } else if (g.kind === 'marquee' && marquee) {
        const tl = screenToCanvas(viewport, marquee.x, marquee.y);
        const br = screenToCanvas(viewport, marquee.x + marquee.w, marquee.y + marquee.h);
        if (marquee.w > 2 || marquee.h > 2) {
          store().boxSelect(
            { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y },
            g.additive,
          );
        }
        setMarquee(null);
      }
    },
    [store, marquee, viewport],
  );

  // Read the visible scene (culled via the spatial index). `rev` forces refresh.
  void rev;
  const box = visibleBox(viewport, size.w, size.h);
  const devices = size.w > 0 ? store().visibleDevices(box) : [];
  const links = size.w > 0 ? store().visibleLinks(box) : [];

  const svgClass = `${styles.svg} ${
    gesture.current.kind === 'pan' ? styles.panning : spaceHeld ? styles.spaceReady : ''
  }`;

  const gridStep = 16 * viewport.scale;

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/nexmap-device') as DeviceType;
      if (!type) return;
      const rect = rootRef.current!.getBoundingClientRect();
      const c = screenToCanvas(viewport, e.clientX - rect.left, e.clientY - rect.top);
      // Drop centers the device under the cursor, then snaps (DA-DES-3.5).
      const x = snap(c.x - 28, altHeld.current);
      const y = snap(c.y - 20, altHeld.current);
      const s = store();
      const id = s.addDeviceAt(type, x, y);
      s.select([id]);
      s.runValidation();
    },
    [store, viewport],
  );

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
        className={svgClass}
        onPointerDown={onRootPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          <pattern
            id="nexmap-grid"
            width={gridStep}
            height={gridStep}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${viewport.tx} ${viewport.ty})`}
          >
            <circle cx={0} cy={0} r={Math.max(0.5, viewport.scale)} fill="var(--canvas-grid)" />
          </pattern>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="url(#nexmap-grid)" />

        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
          {links.map((l) => {
            const a = store().getDevice(l.sourceId);
            const b = store().getDevice(l.targetId);
            if (!a || !b) return null;
            const x1 = a.x + a.width / 2;
            const y1 = a.y + a.height / 2;
            const x2 = b.x + b.width / 2;
            const y2 = b.y + b.height / 2;
            const d = `M${x1} ${y1} L${x2} ${y2}`;
            const sel = selection.has(l.id);
            return (
              <g key={l.id}>
                <path
                  className={styles.linkHit}
                  d={d}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    store().select([l.id], e.shiftKey);
                  }}
                />
                <path className={`${styles.link} ${sel ? styles.selected : ''}`} d={d} />
              </g>
            );
          })}
          {devices.map((dev) => (
            <DeviceNode
              key={dev.id}
              device={dev}
              selected={selection.has(dev.id)}
              scale={viewport.scale}
              onPointerDown={onDevicePointerDown}
            />
          ))}
        </g>

        {marquee && (
          <rect
            className={styles.marquee}
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
          />
        )}
      </svg>

      <div className={styles.zoomBar}>
        <button
          onClick={() => setViewport((v) => zoomAt(v, 1 / 1.2, size.w / 2, size.h / 2))}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className={styles.zoomPct}>{Math.round(viewport.scale * 100)}%</span>
        <button
          onClick={() => setViewport((v) => zoomAt(v, 1.2, size.w / 2, size.h / 2))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setViewport(fitToBox(store().contentBounds(), size.w, size.h))}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
