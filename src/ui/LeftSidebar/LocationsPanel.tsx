import { useMemo, useState } from 'react';
import {
  LOCATION_KINDS,
  cycleIds,
  describeBlockers,
  flattenTree,
  locationPath,
  planSiteConversion,
} from '@/model/location';
import type { LocationKind } from '@/model/types';
import { useProjectStore } from '@/store/projectStore';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './LocationsPanel.module.css';

/** The rung below `kind` — the sensible default when adding a child. */
function childKind(kind: LocationKind): LocationKind {
  const i = LOCATION_KINDS.indexOf(kind);
  return LOCATION_KINDS[Math.min(i + 1, LOCATION_KINDS.length - 1)]!;
}

/**
 * Location navigator (schema v5) — site ▸ building ▸ floor ▸ room ▸ row.
 *
 * Clicking a row selects everything placed there, which is what makes this a
 * navigator rather than a form. The tree is flattened by the pure, tested
 * `flattenTree` so a `parentId` loop renders as a finite list instead of
 * recursing forever and white-screening the canvas.
 *
 * Deleting is BLOCKED while anything still lives at a location (SD-13) — the
 * refusal explains what is inside rather than cascading.
 */
export function LocationsPanel() {
  useProjectStore((s) => s.rev);
  const s = useProjectStore.getState;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; text: string } | null>(null);

  const locations = s().locationsAll();
  const racks = s().racksAll();
  const devices = s().devicesAll();

  const rows = useMemo(
    () => flattenTree(locations, (id) => collapsed.has(id)),
    [locations, collapsed],
  );
  const broken = useMemo(() => cycleIds(locations), [locations]);

  // Direct occupancy per location, one pass instead of a filter per row.
  const counts = useMemo(() => {
    const m = new Map<string, { racks: number; devices: number }>();
    const bump = (id: string | undefined, key: 'racks' | 'devices') => {
      if (id == null) return;
      const cur = m.get(id) ?? { racks: 0, devices: 0 };
      cur[key] += 1;
      m.set(id, cur);
    };
    for (const r of racks) bump(r.locationId, 'racks');
    for (const d of devices) bump(d.locationId, 'devices');
    return m;
  }, [racks, devices]);

  /**
   * The conversion offer. Derived from the SAME planner the action runs, so the
   * label can never promise something different from what the click does — an
   * earlier version counted racks and said "2 site names" while creating 1 site.
   */
  const convert = useMemo(() => {
    const plan = planSiteConversion(racks);
    return { sites: plan.names.length, racks: plan.assign.size };
  }, [racks]);

  const convertLabel = `Convert ${convert.racks} ${
    convert.racks === 1 ? 'rack' : 'racks'
  } → ${convert.sites} ${convert.sites === 1 ? 'site' : 'sites'}`;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Select every rack and device placed at this location. */
  const focusLocation = (id: string) => {
    setSelectedId(id);
    const ids = [
      ...racks.filter((r) => r.locationId === id).map((r) => r.id),
      ...devices.filter((d) => d.locationId === id).map((d) => d.id),
    ];
    if (ids.length > 0) s().select(ids);
  };

  const remove = (id: string, name: string) => {
    const blockers = s().deleteLocation(id);
    if (blockers) {
      setBlocked({
        name,
        text: `still holds ${describeBlockers(blockers)}. Move or delete those first.`,
      });
      return;
    }
    setBlocked(null);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>Locations</span>
        <div className={styles.headerActions}>
          <button
            className={styles.add}
            onClick={() => {
              const id = s().addLocation('New site', 'site');
              setSelectedId(id);
            }}
            title="Add a site"
            aria-label="Add a site"
          >
            <NexIcon name="plus" />
          </button>
        </div>
      </div>

      {blocked && (
        <div className={styles.blocked} role="status">
          <span>
            <strong>{blocked.name}</strong> {blocked.text}
          </span>
          <button
            className={styles.blockedDismiss}
            onClick={() => setBlocked(null)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <NexIcon name="close" />
          </button>
        </div>
      )}

      {/* E17: zero locations is a fully valid state — explain, don't nag. */}
      {locations.length === 0 ? (
        <div className={styles.empty}>
          Group racks and devices by where they physically live, so ports get a real
          address like <code>HQ/28/RK001</code>.
          <div className={styles.emptyActions}>
            <button
              className={`${styles.cta} ${styles.ctaPrimary}`}
              onClick={() => setSelectedId(s().addLocation('New site', 'site'))}
            >
              Add your first site
            </button>
            {convert.sites > 0 && (
              <button
                className={styles.cta}
                onClick={() => s().convertSitesToLocations()}
                title="Create a site for each distinct rack site name. One undoable step; the original text is kept."
              >
                {convertLabel}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.list}>
            {rows.map(({ location: l, depth, hasChildren }) => {
              const c = counts.get(l.id);
              const isCollapsed = collapsed.has(l.id);
              return (
                <div
                  key={l.id}
                  className={`${styles.row} ${l.id === selectedId ? styles.active : ''} ${
                    broken.has(l.id) ? styles.broken : ''
                  }`}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={() => focusLocation(l.id)}
                  title={broken.has(l.id) ? 'This location is part of a hierarchy loop' : undefined}
                >
                  {hasChildren ? (
                    <button
                      className={`${styles.twisty} ${isCollapsed ? styles.collapsed : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(l.id);
                      }}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                      aria-label={isCollapsed ? `Expand ${l.name}` : `Collapse ${l.name}`}
                      aria-expanded={!isCollapsed}
                    >
                      <NexIcon name="chevron-down" />
                    </button>
                  ) : (
                    <span className={styles.twistySpacer} />
                  )}

                  <select
                    className={styles.kind}
                    value={l.kind}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      s().updateLocation(
                        l.id,
                        { kind: l.kind },
                        { kind: e.target.value as LocationKind },
                      )
                    }
                    title="Location kind"
                    aria-label={`Kind of ${l.name}`}
                  >
                    {LOCATION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>

                  <input
                    className={styles.name}
                    value={l.name}
                    onChange={(e) =>
                      s().updateLocation(l.id, { name: l.name }, { name: e.target.value })
                    }
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Name of ${l.name}`}
                  />

                  {c && (
                    <span
                      className={styles.count}
                      title={`${c.racks} rack(s), ${c.devices} device(s) here`}
                    >
                      {c.racks > 0 && `${c.racks}R`}
                      {c.racks > 0 && c.devices > 0 && ' '}
                      {c.devices > 0 && `${c.devices}D`}
                    </span>
                  )}

                  <button
                    className={styles.iconBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        next.delete(l.id);
                        return next;
                      });
                      setSelectedId(s().addLocation('New', childKind(l.kind), l.id));
                    }}
                    title={`Add a ${childKind(l.kind)} inside ${l.name}`}
                    aria-label={`Add a ${childKind(l.kind)} inside ${l.name}`}
                  >
                    <NexIcon name="plus" />
                  </button>

                  <button
                    className={`${styles.iconBtn} ${styles.del}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(l.id, l.name);
                    }}
                    title={`Delete ${l.name}`}
                    aria-label={`Delete ${l.name}`}
                  >
                    <NexIcon name="close" />
                  </button>
                </div>
              );
            })}
          </div>

          {selectedId && (
            <div className={styles.breadcrumb} title="Fully-qualified path (derived)">
              {locationPath(locations, selectedId) || '—'}
            </div>
          )}

          {convert.sites > 0 && (
            <div className={styles.empty}>
              <button
                className={styles.cta}
                onClick={() => s().convertSitesToLocations()}
                title="Create a site for each distinct rack site name. One undoable step; the original text is kept."
              >
                {convertLabel}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
