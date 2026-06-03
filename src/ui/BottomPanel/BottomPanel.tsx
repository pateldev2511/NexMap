import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { defaultDeviceName } from '@/model/schema';
import { severityRank } from '@/model/validate';
import type { Device, Link, ValidationIssue } from '@/model/types';
import { stripPrefix } from '@/lib/ipcidr';
import styles from './BottomPanel.module.css';

/**
 * Collapsible bottom data panel (design review DA-DES-4.2). MVP tabs: Inventory,
 * Links, Validation. Every row/issue jumps to its object on the canvas
 * (DA-DES-2.5) via focusObject. Collapsed by default so the canvas leads.
 */
type Tab = 'inventory' | 'links' | 'validation';

export function BottomPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('validation');
  useProjectStore((s) => s.rev); // refresh on model change
  const issues = useProjectStore((s) => s.issues);
  const store = useProjectStore.getState;

  const devices = store().devicesAll();
  const links = store().linksAll();
  const errorCount = issues.filter(
    (i) => i.severity === 'error' || i.severity === 'critical',
  ).length;

  const tabs: { key: Tab; label: string; count: number; err?: boolean }[] = [
    { key: 'inventory', label: 'Inventory', count: devices.length },
    { key: 'links', label: 'Links', count: links.length },
    { key: 'validation', label: 'Validation', count: issues.length, err: errorCount > 0 },
  ];

  return (
    <div className={styles.panel}>
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
              <span className={`${styles.count} ${t.err ? styles.err : ''}`}>{t.count}</span>
            )}
          </button>
        ))}
        <button
          className={styles.collapseBtn}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
        >
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className={styles.body}>
          {tab === 'inventory' && <InventoryTable devices={devices} />}
          {tab === 'links' && <LinksTable links={links} />}
          {tab === 'validation' && <ValidationList issues={issues} />}
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
          <th>Name</th><th>Type</th><th>Vendor</th><th>Model</th><th>Role</th>
          <th>Location</th><th>IP</th><th>Notes</th>
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
          <th>Name</th><th>Source</th><th>Src iface</th><th>Target</th>
          <th>Tgt iface</th><th>Type</th><th>Bandwidth</th><th>Status</th>
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
              <td style={{ color: broken ? 'var(--sev-error)' : 'var(--chrome-fg-muted)' }}>
                {broken ? 'broken' : 'ok'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ValidationList({ issues }: { issues: ValidationIssue[] }) {
  const focus = useProjectStore((s) => s.focusObject);
  if (issues.length === 0) {
    return <div className={styles.cleanState}>✓ No validation issues — your design looks clean.</div>;
  }
  const sorted = [...issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return (
    <div>
      {sorted.map((i) => (
        <div key={i.id} className={styles.issue} onClick={() => i.objectIds[0] && focus(i.objectIds[0])}>
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
