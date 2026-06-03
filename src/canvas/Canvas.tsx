import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DeviceType } from '@/model/types';
import { useProjectStore } from '@/store/projectStore';
import { DeviceNode } from './DeviceNode';
import { CanvasToolbar } from './CanvasToolbar';
import { ContextMenu, type MenuItem } from './ContextMenu';
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
  | { kind: 'marquee'; startX: number; startY: number; additive: boolean }
  | { kind: 'lasso'; additive: boolean }
  | { kind: 'link'; sourceId: string };

const ZOOM_STEP = 1.0015;

export function Canvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [marquee, setMarquee] = useState<null | { x: number; y: number; w: number; h: number }>(
    null,
  );
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lassoPts, setLassoPts] = useState<{ x: number; y: number }[] | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const gesture = useRef<Gesture>({ kind: 'none' });
  const altHeld = useRef(false);

  const rev = useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const mode = useProjectStore((s) => s.mode);
  const issues = useProjectStore((s) => s.issues);
  const focusTick = useProjectStore((s) => s.focusTick);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const store = useProjectStore.getState;

  // Center on a device when jump-to-object fires (validation/inventory click).
  useEffect(() => {
    if (focusTick === 0) return;
    const id = store().focusTarget;
    const d = id ? store().getDevice(id) : undefined;
    if (!d || size.w === 0) return;
    setViewport((v) => {
      const scale = Math.max(v.scale, 0.75);
      const cx = d.x + d.width / 2;
      const cy = d.y + d.height / 2;
      return { scale, tx: size.w / 2 - cx * scale, ty: size.h / 2 - cy * scale };
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
      if (isTextTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;

      // Viewport + selection shortcuts (viewport lives here in the canvas).
      if (mod && e.key === '0') {
        e.preventDefault();
        setViewport(fitToBox(store().contentBounds(), size.w, size.h));
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
      if (mod) return; // leave other mod combos to the app-level handler

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
      if (e.key === 'c' || e.key === 'C' || e.key === 'l' || e.key === 'L')
        store().setMode('connect');
      if (e.key === 'Escape') {
        if (gesture.current.kind === 'link') cancelLink();
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
    // Re-bind when size changes so Cmd+0/zoom use current dimensions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, size]);

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

  function cancelLink() {
    gesture.current = { kind: 'none' };
    setLinkCursor(null);
    setLinkTarget(null);
  }

  const startLinkFrom = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      rootRef.current!.setPointerCapture(e.pointerId);
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
    return screenToCanvas(viewport, sx, sy);
  }

  const onDevicePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (spaceHeld || store().mode === 'pan') return; // let the root handler pan
      // In connect mode, pressing a device starts a link drag.
      if (store().mode === 'connect') {
        startLinkFrom(e, id);
        return;
      }
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const s = store();
      // Clicking a grouped device selects the whole group (Phase 1 grouping).
      const members = s.groupMembers(id);
      if (!s.selection.has(id)) s.select(members, e.shiftKey);
      else if (e.shiftKey) s.select(members, true);
      s.beginDrag();
      const { sx, sy } = localPoint(e);
      gesture.current = { kind: 'drag', startX: sx, startY: sy, moved: false };
    },
    [spaceHeld, store, localPoint, startLinkFrom],
  );

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { sx, sy } = localPoint(e);
      rootRef.current!.setPointerCapture(e.pointerId);
      if (spaceHeld || e.button === 1 || store().mode === 'pan') {
        gesture.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        return;
      }
      if (store().mode === 'connect') return; // empty press in connect mode = noop
      if (store().mode === 'lasso') {
        gesture.current = { kind: 'lasso', additive: e.shiftKey };
        setLassoPts([{ x: sx, y: sy }]);
        return;
      }
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
      const canvasPt = screenToCanvas(viewport, sx, sy);

      if (g.kind === 'link') {
        setLinkCursor(canvasPt);
        const hit = store().hitTest(canvasPt.x, canvasPt.y);
        const target = hit.find((id) => id !== g.sourceId && store().getDevice(id));
        setLinkTarget(target ?? null);
        return;
      }
      if (g.kind === 'drag') {
        const dx = (sx - g.startX) / viewport.scale;
        const dy = (sy - g.startY) / viewport.scale;
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
    [store, localPoint, viewport, hoveredId],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      gesture.current = { kind: 'none' };
      rootRef.current?.releasePointerCapture?.(e.pointerId);
      if (g.kind === 'drag') {
        store().endDrag();
        if (g.moved) store().runValidation();
      } else if (g.kind === 'link') {
        const target = linkTarget;
        cancelLink();
        if (target && target !== g.sourceId) {
          const id = store().connect(g.sourceId, target);
          if (id) {
            store().select([id]);
            store().runValidation();
          }
        }
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
      } else if (g.kind === 'lasso') {
        if (lassoPts && lassoPts.length >= 3) {
          const poly = lassoPts.map((p) => screenToCanvas(viewport, p.x, p.y));
          store().lassoSelect(poly, g.additive);
        }
        setLassoPts(null);
      }
    },
    [store, marquee, viewport, linkTarget, lassoPts],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
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

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const { sx, sy } = localPoint(e);
      const c = screenToCanvas(viewport, sx, sy);
      const hitId = store().hitTest(c.x, c.y).find((id) => store().getDevice(id));
      const s = store();
      if (hitId && !s.selection.has(hitId)) s.select([hitId]);
      const onDevice = !!hitId;
      const locked = hitId ? !!s.getDevice(hitId)?.locked : false;
      const sel = onDevice || s.selection.size > 0;

      const items: MenuItem[] = onDevice
        ? [
            { label: 'Copy', shortcut: '⌘C', onClick: () => s.copySelection() },
            { label: 'Cut', shortcut: '⌘X', onClick: () => { s.cutSelection(); s.runValidation(); } },
            { label: 'Duplicate', shortcut: '⌘D', onClick: () => { s.duplicateSelection(); s.runValidation(); } },
            { label: 'Paste', shortcut: '⌘V', onClick: () => { s.paste(); s.runValidation(); }, disabled: !s.hasClipboard() },
            { label: 'Bring to front', onClick: () => s.bringToFront(), separatorBefore: true },
            { label: 'Send to back', onClick: () => s.sendToBack() },
            { label: 'Group', shortcut: '⌘G', onClick: () => s.groupSelection(), separatorBefore: true, disabled: s.selection.size < 2 },
            { label: 'Ungroup', shortcut: '⌘⇧G', onClick: () => s.ungroupSelection() },
            { label: locked ? 'Unlock' : 'Lock', onClick: () => s.toggleLockSelection(), separatorBefore: true },
            { label: 'Delete', shortcut: '⌫', onClick: () => { s.deleteSelection(); s.runValidation(); } },
          ]
        : [
            { label: 'Paste', shortcut: '⌘V', onClick: () => { s.paste(); s.runValidation(); }, disabled: !s.hasClipboard() },
            { label: 'Select all', shortcut: '⌘A', onClick: () => s.selectAll(), separatorBefore: true },
          ];
      void sel;
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [store, localPoint, viewport],
  );

  void rev;
  const box = visibleBox(viewport, size.w, size.h);
  const devices = size.w > 0 ? store().visibleDevices(box) : [];
  // Stacking order: lower z renders first (underneath).
  devices.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const links = size.w > 0 ? store().visibleLinks(box) : [];
  const handleDevice = hoveredId ? store().getDevice(hoveredId) : undefined;
  const linkSource =
    gesture.current.kind === 'link' ? store().getDevice(gesture.current.sourceId) : undefined;

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
        className={svgClass}
        onPointerDown={onRootPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoveredId(null)}
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
                    if (store().mode === 'connect') return;
                    e.stopPropagation();
                    store().select([l.id], e.shiftKey);
                  }}
                />
                <path className={`${styles.link} ${sel ? styles.selected : ''}`} d={d} />
              </g>
            );
          })}

          {/* Rubber-band while connecting. */}
          {linkSource && linkCursor && (
            <line
              className={styles.rubber}
              x1={linkSource.x + linkSource.width / 2}
              y1={linkSource.y + linkSource.height / 2}
              x2={linkCursor.x}
              y2={linkCursor.y}
            />
          )}

          {devices.map((dev) => (
            <DeviceNode
              key={dev.id}
              device={dev}
              selected={selection.has(dev.id)}
              scale={viewport.scale}
              validTarget={linkTarget === dev.id}
              hasIssue={errorIds.has(dev.id)}
              onPointerDown={onDevicePointerDown}
            />
          ))}

          {/* Connect handle on the hovered device (select mode, discoverable). */}
          {mode === 'select' && handleDevice && gesture.current.kind === 'none' && (
            <circle
              className={styles.connectHandle}
              cx={handleDevice.x + handleDevice.width}
              cy={handleDevice.y}
              r={6 / viewport.scale}
              onPointerDown={(e) => startLinkFrom(e, handleDevice.id)}
            />
          )}
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
        {lassoPts && lassoPts.length > 1 && (
          <polygon
            className={styles.marquee}
            points={lassoPts.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        )}
      </svg>

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
      />

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

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
