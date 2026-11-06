import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { parsePartsList, planMount } from './partsList';
import type { Rack } from '@/model/types';
import styles from './RackDesigner.module.css';

const EXAMPLE = `2x Cisco Catalyst 9300-48P
Dell PowerEdge R750
2 x 24-port patch panel
1U cable manager
APC Smart-UPS SRT 2200
metered PDU`;

/**
 * Paste a parts list → mount it into the rack. Live preview of what each line was
 * recognised as and where it lands (heaviest at the bottom), what doesn't fit, and
 * what wasn't recognised — nothing changes until "Mount", which is one undo step.
 */
export function PartsListPanel({ rack, onClose }: { rack: Rack; onClose: () => void }) {
  const [text, setText] = useState('');
  const rev = useProjectStore((s) => s.rev); // re-plan when the rack's contents change
  const lines = useMemo(() => parsePartsList(text), [text]);
  const plan = useMemo(
    () => planMount(rack, useProjectStore.getState().devicesAll(), lines),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rack, rev, lines],
  );
  // One preview row per line: how many land, where, and how many don't.
  const rows = lines.map((l) => {
    const items = plan.items.filter((i) => i.line === l);
    const placed = items.filter((i) => i.ru != null);
    const where = placed
      .map((i) => (i.mount === 'rail' ? `${i.side} rail ${i.bay === 'left' ? 'L' : 'R'}` : `U${i.ru}`))
      .join(', ');
    return { l, missing: items.length - placed.length, where };
  });

  const mount = () => {
    useProjectStore.getState().mountPartsList(rack.id, text);
    onClose();
  };

  return (
    <div className={styles.templatePanel} role="dialog" aria-label="Paste a parts list">
      <div className={styles.templateHead}>
        <strong>Paste a parts list into {rack.name}</strong>
        <button className={styles.btn} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className={styles.partsHint}>
        One item per line, from a quote, BOM or email. Quantities like “2x”, “× 2” or “(2)” work. Named models
        (Cisco, Dell, HPE, APC …) get their real height and specs; anything else is matched by what it is. Heaviest
        gear goes at the bottom.
      </p>
      <textarea
        className={styles.partsInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        aria-label="Parts list"
        rows={7}
        autoFocus
      />
      {rows.length > 0 && (
        <ul className={styles.partsPreview} aria-label="What will be mounted">
          {rows.map(({ l, missing, where }) => (
            <li key={l.line} className={!l.preset ? styles.partsUnknown : missing > 0 ? styles.partsShort : undefined}>
              <span className={styles.partsQty}>{l.qty}×</span>
              <span className={styles.partsLabel}>
                {l.preset ? l.label : <em>Not recognised: “{l.raw}”</em>}
                {l.preset && <small> · {l.preset.mount === 'rail' ? '0U rail' : `${l.span}U`}</small>}
              </span>
              <span className={styles.partsWhere}>
                {!l.preset ? 'skipped' : missing > 0 ? `${where ? `${where}; ` : ''}${missing} won’t fit` : where}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.partsFoot}>
        <span>
          {plan.placed > 0 ? `${plan.placed} device${plan.placed === 1 ? '' : 's'} ready` : 'Nothing to mount yet'}
          {plan.noRoom.length > 0 ? ` · ${plan.noRoom.length} won’t fit` : ''}
          {plan.unknown.length > 0 ? ` · ${plan.unknown.length} not recognised` : ''}
        </span>
        <button className={`${styles.btn} ${styles.primary}`} disabled={plan.placed === 0} onClick={mount}>
          Mount {plan.placed > 0 ? plan.placed : ''} into {rack.name}
        </button>
      </div>
    </div>
  );
}
