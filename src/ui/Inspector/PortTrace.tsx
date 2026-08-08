import { useProjectStore } from '@/store/projectStore';
import type { TraceEnd, TraceResult } from '@/rack/cableTrace';
import styles from './PortTrace.module.css';

/**
 * Human wording for why a walk stopped, paired with a non-colour glyph so the
 * outcome is legible without relying on hue (the project's a11y stance).
 *
 * `open` is intentionally NOT an error: an un-patched port is the normal state of
 * most ports in a real rack.
 */
const OUTCOME: Record<
  TraceEnd,
  { glyph: string; tone: 'ok' | 'warn' | 'error'; text: string }
> = {
  terminated: { glyph: '✓', tone: 'ok', text: 'Traced end to end.' },
  open: {
    glyph: '·',
    tone: 'warn',
    text: 'Path ends here — nothing patched onward.',
  },
  loop: {
    glyph: '↻',
    tone: 'error',
    text: 'The cabling loops back on itself, so there is no far end.',
  },
  ambiguous: {
    glyph: '⑂',
    tone: 'error',
    text: 'A port on this path carries more than one cable, so the next hop is undefined.',
  },
  'depth-capped': {
    glyph: '…',
    tone: 'warn',
    text: 'Path is longer than we follow; showing the first hops only.',
  },
};

/** Split a qualified path so the final segment (the port) can carry the emphasis. */
function splitPath(path: string): { head: string; tail: string } {
  const i = path.lastIndexOf('/');
  if (i < 0) return { head: '', tail: path };
  return { head: path.slice(0, i + 1), tail: path.slice(i + 1) };
}

/**
 * The physical path out of one port, hop by hop, in Patchbox's idiom: each hop is a
 * fully-qualified address, and clicking one navigates to that port.
 *
 * This is where W2's locations and W3's trace engine meet — the engine gives the
 * hops, the location tree gives them readable names.
 */
export function PortTrace({
  result,
  currentIfaceId,
}: {
  result: TraceResult;
  currentIfaceId: string;
}) {
  useProjectStore((s) => s.rev);
  const s = useProjectStore.getState;
  const outcome = OUTCOME[result.end];

  return (
    <div>
      <div className={styles.trace}>
        {result.hops.map((hop, i) => {
          const label = s().portLabel(hop.deviceId, hop.ifaceId);
          // A hop can outlive its gear (a cable pointing at a deleted device);
          // show the raw ids rather than an empty row.
          const { head, tail } = splitPath(label || `${hop.deviceId}/${hop.ifaceId}`);
          const isCurrent = hop.ifaceId === currentIfaceId;
          const via =
            hop.via === 'start' ? '▸' : hop.via === 'coupling' ? '⇢' : '—';
          return (
            <button
              key={`${hop.deviceId}|${hop.ifaceId}|${i}`}
              type="button"
              className={`${styles.hop} ${isCurrent ? styles.current : ''}`}
              onClick={() => {
                // Select the device too, so the header reads sensibly. `select`
                // clears the port scope, so it must run FIRST.
                s().select([hop.deviceId]);
                s().selectPort(hop.deviceId, hop.ifaceId);
              }}
              title={
                hop.via === 'coupling'
                  ? 'Internal pass-through inside this panel'
                  : hop.via === 'cable'
                    ? 'Across a patch cable'
                    : 'This port'
              }
              aria-label={`Hop ${i + 1}: ${label || hop.ifaceId}`}
            >
              <span
                className={`${styles.via} ${hop.via === 'coupling' ? styles.viaCoupling : ''}`}
                aria-hidden="true"
              >
                {via}
              </span>
              <span className={styles.path}>
                <span className={styles.pathHead}>{head}</span>
                <span className={styles.pathTail}>{tail}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className={`${styles.outcome} ${styles[outcome.tone]}`} role="status">
        <span className={styles.glyph} aria-hidden="true">
          {outcome.glyph}
        </span>
        <span>{outcome.text}</span>
      </div>
    </div>
  );
}
