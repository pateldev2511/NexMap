import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import {
  describeNexTextKept,
  describeNexTextLosses,
  serializeNexText,
  summarizeNexTextPlan,
  type Diagnostic,
} from '@/lib/nextext';
import { useModalDialog } from './useModalDialog';
import styles from './NexTextDialog.module.css';

const STARTER = `# NexText — describe your network, then Apply.
# <type> <name> [key=value]   |   A - B   |   subnet <cidr>   |   vlan <id>

router R1 vendor=Cisco
switch SW1
server Web1 ip=10.0.0.10

R1 - SW1 vlan=10
SW1 - Web1 bandwidth=1G

subnet 10.0.0.0/24 name=Core gateway=10.0.0.1 vlan=10
vlan 10 name=Users
`;

/** How many removal lines the confirmation spells out before summarising the rest. */
const MAX_LOSS_LINES = 8;

function currentText(): string {
  const s = useProjectStore.getState();
  return serializeNexText({
    devices: s.devicesAll(),
    links: s.linksAll(),
    subnets: s.subnetsAll(),
    vlans: s.vlansAll(),
  });
}

/**
 * NexText editor. The text is a live view of the diagram: Apply SYNCS the diagram to
 * it (one undoable step) — matching devices keep their id, position, rack slot and
 * ports, and only what the text says is changed (#85). The footer previews the plan
 * as you type; Apply is off while there are errors or nothing would change, and asks
 * first only when something would be removed, naming exactly what goes with it.
 */
export function NexTextDialog({ onClose }: { onClose: () => void }) {
  const store = useProjectStore;
  const rev = useProjectStore((s) => s.rev);

  const initial = useMemo(() => {
    const s = store.getState();
    const empty = s.devicesAll().length + s.subnetsAll().length + s.vlansAll().length === 0;
    return empty ? STARTER : currentText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [src, setSrc] = useState(initial);
  const [applied, setApplied] = useState<string | null>(null);
  const { titleId, dialogProps } = useModalDialog(onClose);

  // A dry run of exactly what Apply would do — same parser, same planner, no mutation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => store.getState().applyNexText(src, { dryRun: true }), [src, rev]);
  const diagnostics: Diagnostic[] = preview.diagnostics;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warns = diagnostics.filter((d) => d.severity === 'warn');
  const plan = preview.plan;
  const canApply = errors.length === 0 && !!plan && !plan.isEmpty;

  const apply = () => {
    if (!canApply || !plan) return;
    const losses = describeNexTextLosses(plan);
    if (losses.length > 0) {
      const shown = losses.slice(0, MAX_LOSS_LINES);
      const more = losses.length - shown.length;
      const message = [
        'Apply this NexText?',
        '',
        ...shown,
        ...(more > 0 ? [`… and ${more} more removal${more === 1 ? '' : 's'}`] : []),
        ...describeNexTextKept(plan).slice(0, MAX_LOSS_LINES),
        '',
        'You can undo this.',
      ].join('\n');
      if (!window.confirm(message)) return;
    }
    const result = store.getState().applyNexText(src);
    if (!result.ok) return;
    const w = result.diagnostics.filter((d) => d.severity === 'warn').length;
    const kept = result.plan ? describeNexTextKept(result.plan).length : 0;
    setApplied(
      (w > 0 ? `Applied with ${w} warning${w === 1 ? '' : 's'}.` : 'Applied.') +
        (kept > 0 ? ` ${kept} locked item${kept === 1 ? ' was' : 's were'} kept.` : ''),
    );
    // Removing a device can shift a same-named sibling's handle (web~2 becomes web). If
    // the text no longer describes the diagram it just produced, show the diagram's own
    // text — otherwise a second Apply would act on stale handles.
    const after = store.getState().applyNexText(src, { dryRun: true });
    // Likewise when a lock kept something the text dropped: show that it is still there.
    if (after.ok && after.plan && (!after.plan.isEmpty || kept > 0)) setSrc(currentText());
  };

  const status =
    errors.length > 0
      ? `${errors.length} error${errors.length === 1 ? '' : 's'} — fix to apply`
      : applied && !canApply
        ? applied
        : [
            plan ? summarizeNexTextPlan(plan) : 'Ready',
            warns.length > 0 ? `${warns.length} warning${warns.length === 1 ? '' : 's'}` : '',
          ]
            .filter(Boolean)
            .join(' — ');

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} {...dialogProps} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 id={titleId}>NexText — text to diagram</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>
          <div className={styles.hint}>
            One statement per line. Devices: <code>router R1</code>. Links:{' '}
            <code>R1 - SW1 vlan=10</code> (use <code>-&gt;</code> for a direction). Also{' '}
            <code>subnet 10.0.0.0/24</code> and <code>vlan 10 name=Users</code>. Apply
            updates the diagram to match: devices keep their position, rack slot and
            ports, and a line you delete removes that item. The first word after the type
            identifies the device — to rename one, add <code>name="New name"</code>.
            Quote values with spaces or <code>#</code>: <code>notes="rack #2"</code>.
          </div>
          <textarea
            className={styles.editor}
            value={src}
            spellCheck={false}
            onChange={(e) => {
              setSrc(e.target.value);
              setApplied(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                apply();
              }
            }}
            aria-label="NexText source"
          />
          {diagnostics.length > 0 && (
            <div className={styles.diagnostics}>
              {diagnostics.map((d, i) => (
                <div key={i} className={`${styles.diag} ${styles[d.severity]}`}>
                  <span className={styles.lineBadge}>
                    line {d.line}
                    {d.col != null ? `:${d.col}` : ''}
                  </span>
                  <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.foot}>
          <span className={styles.footMsg} role="status" aria-live="polite" data-testid="nextext-status">
            {status}
          </span>
          <button className={styles.btn} onClick={onClose}>
            Close
          </button>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={apply}
            disabled={!canApply}
            title={errors.length === 0 && !canApply ? 'The diagram already matches this text' : undefined}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
