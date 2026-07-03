import { useMemo, useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import type { Box } from '@/lib/spatial-index';
import styles from './MiniMap.module.css';

const W = 168;
const H = 120;
const PAD = 14;

/**
 * Overview navigator (Stage 4). A scaled bird's-eye of every device in flat scene
 * coordinates, with the current viewport rectangle, and click/drag to recenter the
 * camera. Self-contained: reads devices from the store; the parent supplies the flat
 * viewport rect (or null in iso mode, where flat↔screen isn't a simple rect) and the
 * jump callback (which handles projection).
 */
export function MiniMap({
  viewRect,
  onJump,
}: {
  viewRect: Box | null;
  onJump: (flatX: number, flatY: number) => void;
}) {
  useProjectStore((s) => s.rev); // re-render when the model changes
  const devices = useProjectStore.getState().devicesAll();
  const svgRef = useRef<SVGSVGElement>(null);

  const bounds = useMemo(() => {
    if (devices.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const d of devices) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + d.width);
      maxY = Math.max(maxY, d.y + d.height);
    }
    // Include the viewport so the rect stays visible when panned past the devices.
    if (viewRect) {
      minX = Math.min(minX, viewRect.x);
      minY = Math.min(minY, viewRect.y);
      maxX = Math.max(maxX, viewRect.x + viewRect.width);
      maxY = Math.max(maxY, viewRect.y + viewRect.height);
    }
    return { minX, minY, maxX, maxY };
  }, [devices, viewRect]);

  if (!bounds) return null;

  const sceneW = Math.max(1, bounds.maxX - bounds.minX);
  const sceneH = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.min((W - PAD * 2) / sceneW, (H - PAD * 2) / sceneH);
  const offX = (W - sceneW * k) / 2 - bounds.minX * k;
  const offY = (H - sceneH * k) / 2 - bounds.minY * k;
  const toMini = (fx: number, fy: number) => ({ x: fx * k + offX, y: fy * k + offY });

  const jump = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx = (e.clientX - rect.left - offX) / k;
    const fy = (e.clientY - rect.top - offY) / k;
    onJump(fx, fy);
  };

  const vTL = viewRect ? toMini(viewRect.x, viewRect.y) : null;

  return (
    <svg
      ref={svgRef}
      className={styles.miniMap}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-label="Overview navigator"
      data-canvas-chrome
      onPointerDown={(e) => {
        try {
          svgRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer ids can't be captured — fine */
        }
        jump(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) jump(e);
      }}
    >
      <rect className={styles.bg} x={0} y={0} width={W} height={H} rx={8} />
      {devices.map((d) => {
        const p = toMini(d.x, d.y);
        return (
          <rect
            key={d.id}
            className={styles.node}
            x={p.x}
            y={p.y}
            width={Math.max(2, d.width * k)}
            height={Math.max(2, d.height * k)}
            rx={1}
          />
        );
      })}
      {vTL && viewRect && (
        <rect
          className={styles.view}
          x={vTL.x}
          y={vTL.y}
          width={viewRect.width * k}
          height={viewRect.height * k}
        />
      )}
    </svg>
  );
}
