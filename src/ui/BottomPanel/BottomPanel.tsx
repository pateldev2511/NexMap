import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { getPanelOpen, setPanelOpen } from '@/lib/prefs';
import { NexIcon } from '@/ui/icons/NexIcon';
import { defaultDeviceName } from '@/model/schema';
import { customRuleLabel } from '@/model/invariants';
import { severityRank } from '@/model/validate';
import type { Device, Link, Rack, Subnet, ValidationIssue, Vlan } from '@/model/types';
import { stripPrefix } from '@/lib/ipcidr';
import { subnetUsage, type SubnetUsage } from '@/lib/ipam';
import styles from './BottomPanel.module.css';

/**
 * Collapsible bottom data panel (design review DA-DES-4.2). MVP tabs: Inventory,
 * Links, Validation. Every row/issue jumps to its object on the canvas
 * (DA-DES-2.5) via focusObject. Collapsed by default so the canvas leads.
 */
type Tab = 'inventory' | 'links' | 'ipplan' | 'vlans' | 'racks' | 'validation' | 'health' | 'rules';

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
  const invariantViolations = useProjectStore((s) => s.invariantViolations);
  const errorCount = issues.filter(
    (i) => i.severity === 'error' || i.severity === 'critical',
  ).length;

  const tabs: { key: Tab; label: string; count: number; err?: boolean }[] = [
    { key: 'inventory', label: 'Inventory', count: devices.length },
    { key: 'links', label: 'Links', count: links.length },
    { key: 'ipplan', label: 'IP Plan', count: subnets.length },
    { key: 'vlans', label: 'VLANs', count: vlans.length },
    { key: 'racks', label: 'Racks', count: racks.length },
    { key: 'validation', label: 'Validation', count: issues.length, err: errorCount > 0 },
    { key: 'health', label: 'Health', count: health.issues.length },
    { key: 'rules', label: 'Rules', count: invariantViolations.length, err: invariantViolations.length > 0 },
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
          {tab === 'validation' && <ValidationList issues={issues} />}
          {tab === 'health' && <HealthPanel devices={devices} />}
          {tab === 'rules' && <RulesPanel />}
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

/**
 * Validation codes with a safe, deterministic Conductor remedy, and the store
 * action that applies it. Each action fixes every issue of its kind in one
 * undoable move, so the button on any instance resolves the whole category.
 * Codes absent here (invalid IP/CIDR, VLAN range, overlaps, rack collisions,
 * oversubscription, orphaned device) need a human decision — no button.
 */
const CONDUCTOR_FIX: Record<string, { label: string; title: string; run: () => void }> = {
  'duplicate-ip': {
    label: 'Resolve',
    title: 'Re-address devices that share an IP',
    run: () => useProjectStore.getState().deduplicateIps(),
  },
  'duplicate-name': {
    label: 'Resolve',
    title: 'Rename devices that share a name',
    run: () => useProjectStore.getState().deduplicateNames(),
  },
  'duplicate-vlan': {
    label: 'Resolve',
    title: 'Renumber VLANs that share an 802.1Q ID',
    run: () => useProjectStore.getState().deduplicateVlans(),
  },
  'device-no-name': {
    label: 'Name it',
    title: 'Label unnamed devices from their type',
    run: () => useProjectStore.getState().nameUnnamedDevices(),
  },
  'ip-outside-subnet': {
    label: 'Add subnet',
    title: 'Draw a /24 to cover addresses outside every subnet',
    run: () => useProjectStore.getState().coverOrphanIps(),
  },
  'subnet-no-gateway': {
    label: 'Assign',
    title: 'Adopt an in-range router/firewall as the gateway',
    run: () => useProjectStore.getState().assignGateways(),
  },
  'missing-endpoint': {
    label: 'Prune',
    title: 'Remove links that point at a missing device',
    run: () => useProjectStore.getState().pruneDanglingLinks(),
  },
  'dangling-interface': {
    label: 'Clear ref',
    title: 'Clear link references to a removed interface',
    run: () => useProjectStore.getState().clearDanglingIfaces(),
  },
};

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
  const fixableCount = issues.filter((i) => CONDUCTOR_FIX[i.code]).length;
  return (
    <div>
      {fixableCount > 1 && (
        <div className={styles.fixAllRow}>
          <span className={styles.fixAllLabel}>
            {fixableCount} issue{fixableCount === 1 ? '' : 's'} Conductor can fix automatically
          </span>
          <button
            type="button"
            className={styles.fixBtn}
            title="Run every safe Conductor remedy at once"
            onClick={() => useProjectStore.getState().fixAllSafeIssues()}
          >
            Fix all safe issues
          </button>
        </div>
      )}
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
          {CONDUCTOR_FIX[i.code] && (
            <button
              type="button"
              className={styles.fixBtn}
              title={CONDUCTOR_FIX[i.code]!.title}
              onClick={(e) => {
                e.stopPropagation(); // don't also fire the row's jump-to-object
                CONDUCTOR_FIX[i.code]!.run();
              }}
            >
              {CONDUCTOR_FIX[i.code]!.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Rules — declarative invariants. Each row is a goal the design can declare; once
 * declared, Conductor shows live whether it's met and, if not, lets you jump to
 * the offending objects. (Restoring a violated rule with a fixer is slice 2.)
 */
function RulesPanel() {
  useProjectStore((s) => s.rev); // re-evaluate on model change
  const enabled = useProjectStore((s) => s.invariantsEnabled);
  const violations = useProjectStore((s) => s.invariantViolations);
  const toggleInvariant = useProjectStore((s) => s.toggleInvariant);
  const restoreInvariant = useProjectStore((s) => s.restoreInvariant);
  const restoreAllInvariants = useProjectStore((s) => s.restoreAllInvariants);
  const select = useProjectStore((s) => s.select);
  const invariants = useProjectStore.getState().invariantsAll();
  const byId = new Map(violations.map((v) => [v.id, v]));
  const declared = enabled.size;
  const restorableById = new Map(invariants.map((inv) => [inv.id, inv.restorable]));
  const restorableViolations = violations.filter((v) => restorableById.get(v.id)).length;

  return (
    <div className={styles.rules}>
      <div className={styles.rulesIntro}>
        {declared === 0
          ? 'Declare a rule and Conductor holds your design to it as you edit.'
          : `${declared} rule${declared === 1 ? '' : 's'} declared · ${violations.length} not met`}
      </div>
      {restorableViolations > 1 && (
        <div className={styles.restoreAllRow}>
          <span className={styles.restoreAllLabel}>
            {restorableViolations} declared rules Conductor can restore
          </span>
          <button
            className={styles.ruleRestore}
            onClick={() => restoreAllInvariants()}
            title="Restore every violated rule that has a remedy"
          >
            Restore all
          </button>
        </div>
      )}
      {invariants.map((inv) => {
        const on = enabled.has(inv.id);
        const v = byId.get(inv.id);
        return (
          <div key={inv.id} className={styles.ruleRow}>
            <label className={styles.ruleToggle} title={on ? 'Retract this rule' : 'Declare this rule'}>
              <input type="checkbox" checked={on} onChange={() => toggleInvariant(inv.id)} />
            </label>
            <div className={styles.ruleText}>
              <div className={styles.ruleLabel}>{inv.label}</div>
              <div className={styles.ruleDesc}>{inv.description}</div>
            </div>
            <div className={styles.ruleStatus}>
              {!on ? (
                <span className={styles.ruleOff}>not declared</span>
              ) : v ? (
                <div className={styles.ruleActions}>
                  <button
                    className={styles.ruleCount}
                    onClick={() => select(v.objectIds)}
                    title="Select the objects that break this rule"
                  >
                    {v.objectIds.length} to fix
                  </button>
                  {inv.restorable && (
                    <button
                      className={styles.ruleRestore}
                      onClick={() => restoreInvariant(inv.id)}
                      title="Let Conductor restore this rule"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ) : (
                <span className={styles.ruleMet}>
                  <NexIcon name="check" /> met
                </span>
              )}
            </div>
          </div>
        );
      })}
      <CustomRulesSection />
    </div>
  );
}

/**
 * Custom rules — authored, role-based connectivity invariants. List the design's
 * rules with live status and a remove control, and offer a compact author row:
 * "Every <role> connects to ≥<n> <role>". Not auto-restorable (Conductor won't
 * invent which links to draw), so these flag only.
 */
function CustomRulesSection() {
  useProjectStore((s) => s.rev); // re-evaluate on model change
  const customRules = useProjectStore((s) => s.customRules);
  const violations = useProjectStore((s) => s.invariantViolations);
  const addCustomRule = useProjectStore((s) => s.addCustomRule);
  const removeCustomRule = useProjectStore((s) => s.removeCustomRule);
  const select = useProjectStore((s) => s.select);
  const byId = new Map(violations.map((v) => [v.id, v]));
  const roles = [
    ...new Set(
      useProjectStore
        .getState()
        .devicesAll()
        .map((d) => d.role?.trim())
        .filter((r): r is string => !!r),
    ),
  ];
  const [kind, setKind] = useState<'connectivity' | 'isolation'>('connectivity');
  const [fromRole, setFromRole] = useState('');
  const [toRole, setToRole] = useState('');
  const [min, setMin] = useState('2');
  const canAdd =
    fromRole.trim() !== '' && toRole.trim() !== '' && (kind === 'isolation' || Number(min) >= 1);
  const submit = () => {
    if (!canAdd) return;
    addCustomRule(kind, fromRole, toRole, Number(min));
    setFromRole('');
    setToRole('');
    setMin('2');
  };

  return (
    <div className={styles.customRules}>
      <div className={styles.customHeader}>Custom rules</div>
      {customRules.map((r) => {
        const v = byId.get(r.id);
        return (
          <div key={r.id} className={styles.ruleRow}>
            <div className={styles.ruleText}>
              <div className={styles.ruleLabel}>{customRuleLabel(r)}</div>
              <div className={styles.ruleDesc}>Role-based connectivity</div>
            </div>
            <div className={styles.ruleStatus}>
              {v ? (
                <button
                  className={styles.ruleCount}
                  onClick={() => select(v.objectIds)}
                  title="Select the objects that break this rule"
                >
                  {v.objectIds.length} to fix
                </button>
              ) : (
                <span className={styles.ruleMet}>
                  <NexIcon name="check" /> met
                </span>
              )}
            </div>
            <button
              className={styles.ruleRemove}
              onClick={() => removeCustomRule(r.id)}
              title="Remove this rule"
              aria-label="Remove rule"
            >
              ×
            </button>
          </div>
        );
      })}
      <div className={styles.customAdd}>
        <span className={styles.customAddLabel}>Every</span>
        <input
          list="nx-roles"
          className={styles.customInput}
          placeholder="role"
          value={fromRole}
          onChange={(e) => setFromRole(e.target.value)}
          aria-label="from role"
        />
        <select
          className={styles.customKind}
          value={kind}
          onChange={(e) => setKind(e.target.value as 'connectivity' | 'isolation')}
          aria-label="rule kind"
        >
          <option value="connectivity">connects to ≥</option>
          <option value="isolation">must not reach</option>
        </select>
        {kind === 'connectivity' && (
          <input
            className={styles.customNum}
            type="number"
            min={1}
            value={min}
            onChange={(e) => setMin(e.target.value)}
            aria-label="minimum"
          />
        )}
        <input
          list="nx-roles"
          className={styles.customInput}
          placeholder="role"
          value={toRole}
          onChange={(e) => setToRole(e.target.value)}
          aria-label="to role"
        />
        <button className={styles.ruleRestore} disabled={!canAdd} onClick={submit}>
          Add
        </button>
        <datalist id="nx-roles">
          {roles.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
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
