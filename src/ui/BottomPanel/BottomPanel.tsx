import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { getPanelOpen, setPanelOpen } from '@/lib/prefs';
import { NexIcon } from '@/ui/icons/NexIcon';
import { defaultDeviceName } from '@/model/schema';
import { severityRank } from '@/model/validate';
import type { Device, Link, Rack, Subnet, ValidationIssue, Vlan } from '@/model/types';
import { stripPrefix } from '@/lib/ipcidr';
import { subnetUsage, type SubnetUsage } from '@/lib/ipam';
import type { Reconciliation } from '@/rack/reconcile';
import styles from './BottomPanel.module.css';

/**
 * Collapsible bottom data panel (design review DA-DES-4.2). MVP tabs: Inventory,
 * Links, Validation. Every row/issue jumps to its object on the canvas
 * (DA-DES-2.5) via focusObject. Collapsed by default so the canvas leads.
 */
type Tab =
  | 'inventory'
  | 'links'
  | 'ipplan'
  | 'vlans'
  | 'racks'
  | 'cabling'
  | 'validation'
  | 'health';

export function BottomPanel() {
  // Open/closed survives reloads (M3c). Collapsed, the tab strip stays as a
  // rail whose per-tab counts ARE the validation badge — issues never hide.
  const [open, setOpenState] = useState(() => getPanelOpen('bottom', false));
  const setOpen = (v: boolean | ((o: boolean) => boolean)) =>
    setOpenState((o) => {
      const next = typeof v === 'function' ? v(o) : v;
      setPanelOpen('bottom', next);
      return next;
    });
  const [tab, setTab] = useState<Tab>('validation');
  useProjectStore((s) => s.rev); // refresh on model change
  const issues = useProjectStore((s) => s.issues);
  const store = useProjectStore.getState;

  const devices = store().devicesAll();
  const links = store().linksAll();
  const subnets = store().subnetsAll();
  const vlans = store().vlansAll();
  const racks = store().racksAll();
  const health = useProjectStore((s) => s.health);
  // Derived on demand — nothing about the physical/logical delta is persisted.
  const cabling = store().reconcileCabling();
  const cablingFindings = cabling.unbacked.length + cabling.undocumented.length;
  const errorCount = issues.filter(
    (i) => i.severity === 'error' || i.severity === 'critical',
  ).length;

  const tabs: { key: Tab; label: string; count: number; err?: boolean }[] = [
    { key: 'inventory', label: 'Inventory', count: devices.length },
    { key: 'links', label: 'Links', count: links.length },
    { key: 'ipplan', label: 'IP Plan', count: subnets.length },
    { key: 'vlans', label: 'VLANs', count: vlans.length },
    { key: 'racks', label: 'Racks', count: racks.length },
    { key: 'cabling', label: 'Cabling', count: cablingFindings },
    { key: 'validation', label: 'Validation', count: issues.length, err: errorCount > 0 },
    { key: 'health', label: 'Health', count: health.issues.length },
  ];

  return (
    <div className={styles.panel} data-demote="panel">
      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${open && tab === t.key ? styles.active : ''}`}
            onClick={() => {
              if (open && tab === t.key) setOpen(false);
              else {
                setTab(t.key);
                setOpen(true);
              }
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`${styles.count} ${t.err ? styles.err : ''}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
        <button
          className={styles.collapseBtn}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
        >
          <NexIcon name={open ? 'chevron-down' : 'chevron-up'} />
        </button>
      </div>
      {open && (
        <div className={styles.body}>
          {tab === 'inventory' && <InventoryTable devices={devices} />}
          {tab === 'links' && <LinksTable links={links} />}
          {tab === 'ipplan' && <SubnetTable subnets={subnets} vlans={vlans} />}
          {tab === 'vlans' && <VlanTable vlans={vlans} />}
          {tab === 'racks' && <RackTable racks={racks} devices={devices} />}
          {tab === 'cabling' && <CablingPanel reconciliation={cabling} />}
          {tab === 'validation' && <ValidationList issues={issues} />}
          {tab === 'health' && <HealthPanel devices={devices} />}
        </div>
      )}
    </div>
  );
}

/**
 * Cabling: the delta between what was DESIGNED (`links[]`) and what is actually
 * PATCHED (`rackCables[]` + pass-throughs). See rack/reconcile.ts.
 *
 * Quiet by default on purpose. Only links whose both endpoints are rack-mounted are
 * in scope, so a diagram drawn without racks reports nothing rather than flagging
 * every link as un-cabled.
 */
function CablingPanel({ reconciliation }: { reconciliation: Reconciliation }) {
  const focus = useProjectStore((s) => s.focusObject);
  const selectPort = useProjectStore((s) => s.selectPort);
  const store = useProjectStore.getState;
  const { backed, unbacked, undocumented, power, outOfScope, danglingCables } =
    reconciliation;

  const nothingInScope =
    backed.length + unbacked.length === 0 && undocumented.length === 0 && power.length === 0;
  if (nothingInScope) {
    return (
      <div className={styles.empty}>
        {outOfScope > 0
          ? `Nothing to compare yet — ${outOfScope} link${outOfScope === 1 ? '' : 's'} ${
              outOfScope === 1 ? 'connects' : 'connect'
            } gear that is not rack-mounted. Mount devices in the Rack designer and cable their ports to check the diagram against the patching.`
          : 'Nothing to compare yet. Mount devices in the Rack designer and cable their ports to check the diagram against the patching.'}
      </div>
    );
  }

  const linkName = (id: string) => {
    const l = store().getLink(id);
    if (!l) return '(missing link)';
    const src = store().getDevice(l.sourceId)?.name ?? '(missing)';
    const tgt = store().getDevice(l.targetId)?.name ?? '(missing)';
    return l.name ? `${l.name} · ${src} → ${tgt}` : `${src} → ${tgt}`;
  };

  return (
    <div className={styles.cabling}>
      <div className={styles.cablingSummary}>
        <span>
          <strong>{backed.length}</strong> documented and patched
        </span>
        <span>
          <strong>{unbacked.length}</strong> designed, not cabled
        </span>
        <span>
          <strong>{undocumented.length}</strong> cabled, not documented
        </span>
        {power.length > 0 && (
          <span title="End-to-end power feeds from a UPS or PDU outlet. Not a discrepancy — power is not drawn in the logical topology.">
            <strong>{power.length}</strong> power {power.length === 1 ? 'feed' : 'feeds'}
          </span>
        )}
        {danglingCables > 0 && (
          <span title="Cables that are not part of any complete end-to-end path">
            <strong>{danglingCables}</strong> going nowhere
          </span>
        )}
        {outOfScope > 0 && (
          <span
            className={styles.cablingMuted}
            title="Links whose endpoints are not both rack-mounted, so there is no physical layer to compare against"
          >
            {outOfScope} out of scope
          </span>
        )}
      </div>

      {unbacked.length > 0 && (
        <>
          <div className={styles.cablingHead}>Designed, not cabled</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Link</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {unbacked.map((u) => (
                <tr key={u.linkId} className={styles.row} onClick={() => focus(u.linkId)}>
                  <td>{linkName(u.linkId)}</td>
                  <td style={{ color: 'var(--chrome-fg-muted)' }}>
                    {u.reason === 'no-cable'
                      ? 'No cabling on either end yet'
                      : 'Cabling exists but does not join these two'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {undocumented.length > 0 && (
        <>
          <div className={styles.cablingHead}>Cabled, not documented</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Hops</th>
              </tr>
            </thead>
            <tbody>
              {undocumented.map((c) => (
                <tr
                  key={`${c.a.deviceId}:${c.a.ifaceId}-${c.b.deviceId}:${c.b.ifaceId}`}
                  className={styles.row}
                  onClick={() => {
                    // Jump to the near end AND open its port scope, so the trace is
                    // one click away rather than something to go hunting for.
                    focus(c.a.deviceId);
                    selectPort(c.a.deviceId, c.a.ifaceId);
                  }}
                >
                  <td>{store().portLabel(c.a.deviceId, c.a.ifaceId)}</td>
                  <td>{store().portLabel(c.b.deviceId, c.b.ifaceId)}</td>
                  <td>{c.hops}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {unbacked.length === 0 && undocumented.length === 0 && (
        <div className={styles.empty}>
          Every in-scope link is backed by real cabling, and every circuit is
          documented.
        </div>
      )}
    </div>
  );
}

function InventoryTable({ devices }: { devices: Device[] }) {
  const focus = useProjectStore((s) => s.focusObject);
  if (devices.length === 0) return <div className={styles.empty}>No devices yet.</div>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Vendor</th>
          <th>Model</th>
          <th>Role</th>
          <th>Location</th>
          <th>IP</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => (
          <tr key={d.id} className={styles.row} onClick={() => focus(d.id)}>
            <td>{d.name}</td>
            <td>{defaultDeviceName(d.type)}</td>
            <td>{d.vendor ?? ''}</td>
            <td>{d.model ?? ''}</td>
            <td>{d.role ?? ''}</td>
            <td>{d.location ?? ''}</td>
            <td>{d.managementIp ? stripPrefix(d.managementIp) : ''}</td>
            <td>{d.notes ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinksTable({ links }: { links: Link[] }) {
  const focus = useProjectStore((s) => s.focusObject);
  const store = useProjectStore.getState;
  if (links.length === 0) return <div className={styles.empty}>No links yet.</div>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Source</th>
          <th>Src iface</th>
          <th>Target</th>
          <th>Tgt iface</th>
          <th>Type</th>
          <th>Bandwidth</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {links.map((l) => {
          const src = store().getDevice(l.sourceId);
          const tgt = store().getDevice(l.targetId);
          const broken = !src || !tgt;
          return (
            <tr key={l.id} className={styles.row} onClick={() => focus(l.id)}>
              <td>{l.name ?? '—'}</td>
              <td>{src?.name ?? '(missing)'}</td>
              <td>{l.sourceInterface ?? ''}</td>
              <td>{tgt?.name ?? '(missing)'}</td>
              <td>{l.targetInterface ?? ''}</td>
              <td>{l.linkType ?? ''}</td>
              <td>{l.bandwidth ?? ''}</td>
              <td
                style={{ color: broken ? 'var(--sev-error)' : 'var(--chrome-fg-muted)' }}
              >
                {broken ? 'broken' : 'ok'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Cell({
  value,
  onCommit,
  type = 'text',
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const endEdit = useProjectStore((s) => s.endEdit);
  return (
    <input
      className={styles.cellInput}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onCommit(e.target.value)}
      onBlur={endEdit}
    />
  );
}

/** Compact subnet utilization bar (Stage 1 IPAM). */
function UsageBar({ usage }: { usage: SubnetUsage }) {
  const pct = Math.round(usage.utilization * 100);
  const tone =
    usage.exhausted || pct >= 90 ? 'high' : pct >= 70 ? 'mid' : 'low';
  return (
    <div className={styles.usage} title={`${usage.used} of ${usage.capacity} hosts used`}>
      <div className={styles.usageBar}>
        <div
          className={`${styles.usageFill} ${styles[`usage_${tone}`]}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={styles.usageText}>
        {usage.used}/{usage.capacity}
      </span>
    </div>
  );
}

function SubnetTable({ subnets, vlans }: { subnets: Subnet[]; vlans: Vlan[] }) {
  const update = useProjectStore((s) => s.updateSubnet);
  const del = useProjectStore((s) => s.deleteSubnet);
  const add = useProjectStore((s) => s.addSubnet);
  const ipKey = useProjectStore((s) =>
    s.devicesAll().map((d) => d.managementIp ?? '').join(','),
  );
  const usedIps = ipKey.split(',').filter(Boolean);
  const set = (sub: Subnet, key: keyof Subnet, val: string | number | undefined) =>
    update(
      sub.id,
      { [key]: sub[key] } as Partial<Subnet>,
      { [key]: val } as Partial<Subnet>,
    );
  return (
    <div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>CIDR</th>
            <th>Name</th>
            <th>Gateway</th>
            <th>VLAN</th>
            <th>Usage</th>
            <th>Zone</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {subnets.map((sn) => (
            <tr key={sn.id}>
              <td>
                <Cell
                  value={sn.cidr}
                  onCommit={(v) => set(sn, 'cidr', v)}
                  placeholder="10.0.0.0/24"
                />
              </td>
              <td>
                <Cell value={sn.name ?? ''} onCommit={(v) => set(sn, 'name', v)} />
              </td>
              <td>
                <Cell
                  value={sn.gateway ?? ''}
                  onCommit={(v) => set(sn, 'gateway', v)}
                  placeholder="10.0.0.1"
                />
              </td>
              <td>
                <Cell
                  value={sn.vlanId != null ? String(sn.vlanId) : ''}
                  onCommit={(v) => set(sn, 'vlanId', v ? Number(v) : undefined)}
                  placeholder="—"
                />
              </td>
              <td>
                {(() => {
                  const usage = subnetUsage(sn.cidr, usedIps, { gateway: sn.gateway });
                  return usage ? <UsageBar usage={usage} /> : <span>—</span>;
                })()}
              </td>
              <td>
                <Cell value={sn.zone ?? ''} onCommit={(v) => set(sn, 'zone', v)} />
              </td>
              <td>
                <Cell value={sn.notes ?? ''} onCommit={(v) => set(sn, 'notes', v)} />
              </td>
              <td>
                <button
                  className={styles.rowDelete}
                  onClick={() => del(sn.id)}
                  aria-label="Delete subnet"
                >
                  <NexIcon name="close" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={styles.addRow} onClick={() => add('10.0.0.0/24')}>
        <NexIcon name="plus" />
        <span>Add subnet</span>
      </button>
      {vlans.length > 0 && subnets.length === 0 && (
        <span style={{ fontSize: 11, color: 'var(--chrome-fg-muted)', marginLeft: 8 }}>
          Tip: link a subnet to a VLAN by its ID.
        </span>
      )}
    </div>
  );
}

function VlanTable({ vlans }: { vlans: Vlan[] }) {
  const update = useProjectStore((s) => s.updateVlan);
  const del = useProjectStore((s) => s.deleteVlan);
  const add = useProjectStore((s) => s.addVlan);
  const set = (v: Vlan, key: keyof Vlan, val: string | number) =>
    update(v.id, { [key]: v[key] } as Partial<Vlan>, { [key]: val } as Partial<Vlan>);
  const nextId = (vlans.reduce((m, v) => Math.max(m, v.vlanId), 0) || 0) + 1;
  return (
    <div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>VLAN ID</th>
            <th>Name</th>
            <th>Zone</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {vlans.map((v) => (
            <tr key={v.id}>
              <td>
                <Cell
                  type="number"
                  value={String(v.vlanId)}
                  onCommit={(x) => set(v, 'vlanId', Number(x))}
                />
              </td>
              <td>
                <Cell value={v.name} onCommit={(x) => set(v, 'name', x)} />
              </td>
              <td>
                <Cell value={v.zone ?? ''} onCommit={(x) => set(v, 'zone', x)} />
              </td>
              <td>
                <Cell value={v.notes ?? ''} onCommit={(x) => set(v, 'notes', x)} />
              </td>
              <td>
                <button
                  className={styles.rowDelete}
                  onClick={() => del(v.id)}
                  aria-label="Delete VLAN"
                >
                  <NexIcon name="close" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={styles.addRow} onClick={() => add(nextId, `VLAN ${nextId}`)}>
        <NexIcon name="plus" />
        <span>Add VLAN</span>
      </button>
    </div>
  );
}

function RackTable({ racks, devices }: { racks: Rack[]; devices: Device[] }) {
  const update = useProjectStore((s) => s.updateRack);
  const del = useProjectStore((s) => s.deleteRack);
  const add = useProjectStore((s) => s.addRack);
  const focus = useProjectStore((s) => s.focusObject);
  const set = (r: Rack, key: keyof Rack, val: string | number) =>
    update(r.id, { [key]: r[key] } as Partial<Rack>, { [key]: val } as Partial<Rack>);
  return (
    <div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Rack</th>
            <th>RU height</th>
            <th>Site</th>
            <th>Mounted</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {racks.map((r) => {
            const mounted = devices.filter((d) => d.rackId === r.id);
            return (
              <tr key={r.id}>
                <td>
                  <Cell value={r.name} onCommit={(v) => set(r, 'name', v)} />
                </td>
                <td>
                  <Cell
                    type="number"
                    value={String(r.ruHeight)}
                    onCommit={(v) => set(r, 'ruHeight', Number(v) || 1)}
                  />
                </td>
                <td>
                  <Cell value={r.site ?? ''} onCommit={(v) => set(r, 'site', v)} />
                </td>
                <td>
                  {mounted.length === 0 ? (
                    <span style={{ color: 'var(--chrome-fg-muted)' }}>—</span>
                  ) : (
                    mounted.map((d, i) => (
                      <span key={d.id}>
                        <a
                          style={{ color: 'var(--accent)', cursor: 'pointer' }}
                          onClick={() => focus(d.id)}
                        >
                          {d.name}@U{d.ru ?? '?'}
                        </a>
                        {i < mounted.length - 1 ? ', ' : ''}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  <Cell value={r.notes ?? ''} onCommit={(v) => set(r, 'notes', v)} />
                </td>
                <td>
                  <button
                    className={styles.rowDelete}
                    onClick={() => del(r.id)}
                    aria-label="Delete rack"
                  >
                    <NexIcon name="close" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className={styles.addRow} onClick={() => add(`Rack ${racks.length + 1}`)}>
        <NexIcon name="plus" />
        <span>Add rack</span>
      </button>
    </div>
  );
}

function ValidationList({ issues }: { issues: ValidationIssue[] }) {
  const focus = useProjectStore((s) => s.focusObject);
  if (issues.length === 0) {
    return (
      <div className={styles.cleanState}>
        <NexIcon name="check" />
        <span>No validation issues - your design looks clean.</span>
      </div>
    );
  }
  const sorted = [...issues].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
  return (
    <div>
      {sorted.map((i) => (
        <div
          key={i.id}
          className={styles.issue}
          onClick={() => i.objectIds[0] && focus(i.objectIds[0])}
        >
          <span
            className={`${styles.sev} ${
              i.severity === 'error' || i.severity === 'critical'
                ? styles.sevError
                : i.severity === 'warn'
                  ? styles.sevWarn
                  : styles.sevInfo
            }`}
          >
            {i.severity.toUpperCase()}
          </span>
          <span className={styles.issueMsg}>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

function HealthPanel({ devices }: { devices: Device[] }) {
  const health = useProjectStore((s) => s.health);
  const focus = useProjectStore((s) => s.focusObject);
  const checkRedundancy = useProjectStore((s) => s.checkRedundancy);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [result, setResult] = useState<number | null>(null);

  const scoreTone =
    health.score >= 85 ? styles.usage_low : health.score >= 60 ? styles.usage_mid : styles.usage_high;

  const run = () => {
    if (!a || !b || a === b) return;
    setResult(checkRedundancy(a, b));
  };

  return (
    <div className={styles.health}>
      <div className={styles.healthScore}>
        <span className={`${styles.scoreBadge} ${scoreTone}`}>{health.score}</span>
        <span className={styles.scoreLabel}>
          Topology soundness{health.scanDerived ? ' · some links are scan-inferred' : ''}
        </span>
      </div>

      {health.issues.length === 0 ? (
        <div className={styles.cleanState}>
          <NexIcon name="check" />
          <span>No topology-health concerns — no single points of failure or fragmentation.</span>
        </div>
      ) : (
        <div>
          {[...health.issues]
            .sort((x, y) => severityRank(y.severity) - severityRank(x.severity))
            .map((i) => (
              <div
                key={i.id}
                className={styles.issue}
                onClick={() => i.objectIds[0] && focus(i.objectIds[0])}
              >
                <span
                  className={`${styles.sev} ${
                    i.severity === 'warn' ? styles.sevWarn : styles.sevInfo
                  }`}
                >
                  {i.severity.toUpperCase()}
                </span>
                <span className={styles.issueMsg}>{i.message}</span>
              </div>
            ))}
        </div>
      )}

      <div className={styles.redundancy}>
        <span className={styles.redundancyTitle}>Path redundancy</span>
        <select value={a} onChange={(e) => { setA(e.target.value); setResult(null); }} aria-label="From device">
          <option value="">From…</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select value={b} onChange={(e) => { setB(e.target.value); setResult(null); }} aria-label="To device">
          <option value="">To…</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button className={styles.addRow} onClick={run} disabled={!a || !b || a === b}>
          Check
        </button>
        {result !== null && (
          <span className={styles.redundancyResult}>
            {result === 0
              ? 'No path between them.'
              : result === 1
                ? '1 path — no redundancy (any single link cut isolates them).'
                : `${result} edge-disjoint paths — redundant.`}
          </span>
        )}
      </div>
    </div>
  );
}
