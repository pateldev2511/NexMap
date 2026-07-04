/**
 * Dev-only input recorder behind the `?debug=input` URL flag — the capture
 * side of the fixture-provenance rule (docs/designs/pointer-native-canvas.md):
 * real-device traces recorded here replace/augment the synthetic-labeled
 * fixtures in src/input/__fixtures__/.
 *
 * Usage (dev server only):
 *   1. open http://localhost:5173/?debug=input
 *   2. perform the gestures (trackpad two-finger pan, pinch, mouse notches…)
 *   3. in the console: __nexmapInputLog.download('mac-trackpad-pan')
 *
 * Records to a ring buffer in memory; nothing ever leaves the machine
 * (download = a local file the browser writes). Never installed in prod
 * builds — main.tsx gates on import.meta.env.DEV, and the flag besides.
 */
import { normalizeWheel } from './wheel';

interface WheelEntry {
  kind: 'wheel';
  t: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  normalized: { dx: number; dy: number; zoomDelta: number; cls: string };
}

interface PointerEntry {
  kind: 'pointer';
  t: number;
  type: string; // pointerdown | pointermove | pointerup | pointercancel
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
  x: number;
  y: number;
}

type Entry = WheelEntry | PointerEntry;

const MAX_ENTRIES = 5000;

export function installInputDebugLogger(win: Window = window): void {
  const params = new URLSearchParams(win.location.search);
  if (params.get('debug') !== 'input') return;

  const log: Entry[] = [];
  const push = (e: Entry) => {
    log.push(e);
    if (log.length > MAX_ENTRIES) log.shift();
  };

  win.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      const n = normalizeWheel(e);
      push({
        kind: 'wheel',
        t: e.timeStamp,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        normalized: { dx: n.dx, dy: n.dy, zoomDelta: n.zoomDelta, cls: n.cls },
      });
    },
    { capture: true, passive: true },
  );

  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    win.addEventListener(
      type,
      (ev: Event) => {
        const e = ev as PointerEvent;
        push({
          kind: 'pointer',
          t: e.timeStamp,
          type,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          button: e.button,
          buttons: e.buttons,
          x: e.clientX,
          y: e.clientY,
        });
      },
      { capture: true, passive: true },
    );
  }

  const api = {
    dump: () => log.slice(),
    clear: () => {
      log.length = 0;
    },
    /** Download the buffer as a real-device fixture (synthetic: false). */
    download: (name = 'input-trace') => {
      const payload = {
        synthetic: false,
        recordedAt: new Date().toISOString(),
        userAgent: win.navigator.userAgent,
        name,
        events: log,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const a = win.document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  };
  (win as Window & { __nexmapInputLog?: typeof api }).__nexmapInputLog = api;
  console.info(
    '[nexmap] input debug logger active — record gestures, then __nexmapInputLog.download("name")',
  );
}
