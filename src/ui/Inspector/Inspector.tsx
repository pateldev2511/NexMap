import { useProjectStore } from '@/store/projectStore';
import type { CanvasObject, Device, DeviceType, Link } from '@/model/types';
import { isValidIp, isValidCidr } from '@/lib/ipcidr';
import { defaultDeviceName } from '@/model/schema';
import styles from './Inspector.module.css';

/**
 * Properties inspector (design review DA-DES-4.1). Grouped fields, MVP subset
 * (~8 device fields), undoable edits with inline validation. Single selection →
 * full detail; multi → count + shared delete; empty → project properties.
 */

const DEVICE_TYPES: DeviceType[] = [
  'router', 'switch', 'firewall', 'access-point', 'wireless-controller', 'server',
  'storage', 'load-balancer', 'end-user', 'printer', 'iot', 'isp', 'cloud', 'vm',
  'container', 'rack', 'patch-panel', 'ups', 'camera', 'vpc', 'cloud-subnet',
  'internet-gateway', 'nat-gateway', 'route-table', 'security-group', 'vpn-gateway',
  'k8s', 'managed-db', 'object-storage', 'generic',
];

function ipError(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.includes('/')) return isValidCidr(v) ? null : 'Not a valid CIDR.';
  return isValidIp(v) ? null : 'Not a valid IP address.';
}

function DeviceInspector({ device }: { device: Device }) {
  const updateDevice = useProjectStore((s) => s.updateDevice);
  const endEdit = useProjectStore((s) => s.endEdit);

  function set<K extends keyof Device>(key: K, value: Device[K]) {
    updateDevice(device.id, { [key]: device[key] } as Partial<Device>, {
      [key]: value,
    } as Partial<Device>);
  }

  const mgmtErr = ipError(device.managementIp);

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Identity</div>
        <Field label="Name">
          <input
            value={device.name}
            onChange={(e) => set('name', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="Type">
          <select value={device.type} onChange={(e) => { set('type', e.target.value as DeviceType); endEdit(); }}>
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {defaultDeviceName(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendor">
          <input value={device.vendor ?? ''} onChange={(e) => set('vendor', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Model">
          <input value={device.model ?? ''} onChange={(e) => set('model', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Role">
          <input value={device.role ?? ''} onChange={(e) => set('role', e.target.value)} onBlur={endEdit} />
        </Field>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Network</div>
        <Field label="Management IP" error={mgmtErr}>
          <input
            className={mgmtErr ? styles.invalid : ''}
            value={device.managementIp ?? ''}
            placeholder="10.0.0.1 or 10.0.0.1/24"
            onChange={(e) => set('managementIp', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
      </div>

      <RackFields device={device} set={set} endEdit={endEdit} />

      <div className={styles.group}>
        <div className={styles.groupTitle}>Location & Notes</div>
        <Field label="Location">
          <input value={device.location ?? ''} onChange={(e) => set('location', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Notes">
          <textarea value={device.notes ?? ''} onChange={(e) => set('notes', e.target.value)} onBlur={endEdit} />
        </Field>
      </div>
    </>
  );
}

function RackFields({
  device,
  set,
  endEdit,
}: {
  device: Device;
  set: <K extends keyof Device>(key: K, value: Device[K]) => void;
  endEdit: () => void;
}) {
  const racks = useProjectStore((s) => s.racksAll());
  if (racks.length === 0) return null;
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Rack placement</div>
      <Field label="Rack">
        <select value={device.rackId ?? ''} onChange={(e) => { set('rackId', e.target.value || undefined); endEdit(); }}>
          <option value="">— none —</option>
          {racks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      {device.rackId && (
        <>
          <Field label="Position (U)">
            <input
              type="number"
              value={device.ru ?? 1}
              onChange={(e) => set('ru', Number(e.target.value))}
              onBlur={endEdit}
            />
          </Field>
          <Field label="Height (U)">
            <input
              type="number"
              value={device.ruSpan ?? 1}
              onChange={(e) => set('ruSpan', Number(e.target.value))}
              onBlur={endEdit}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function LinkInspector({ link }: { link: Link }) {
  const updateLink = useProjectStore((s) => s.updateLink);
  const endEdit = useProjectStore((s) => s.endEdit);
  const source = useProjectStore((s) => s.getDevice(link.sourceId));
  const target = useProjectStore((s) => s.getDevice(link.targetId));

  function set<K extends keyof Link>(key: K, value: Link[K]) {
    updateLink(link.id, { [key]: link[key] } as Partial<Link>, { [key]: value } as Partial<Link>);
  }

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Link</div>
        <Field label="Name">
          <input value={link.name ?? ''} onChange={(e) => set('name', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Type">
          <input value={link.linkType ?? ''} placeholder="ethernet, fiber…" onChange={(e) => set('linkType', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Bandwidth">
          <input value={link.bandwidth ?? ''} placeholder="1G, 10G…" onChange={(e) => set('bandwidth', e.target.value)} onBlur={endEdit} />
        </Field>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Connector</div>
        <Field label="Line">
          <select value={link.style ?? 'solid'} onChange={(e) => { set('style', e.target.value as 'solid' | 'dashed'); endEdit(); }}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </Field>
        <Field label="Arrows">
          <select value={link.arrow ?? 'end'} onChange={(e) => { set('arrow', e.target.value as 'none' | 'end' | 'both'); endEdit(); }}>
            <option value="none">None</option>
            <option value="end">End</option>
            <option value="both">Both ends</option>
          </select>
        </Field>
        <Field label="Routing">
          <select value={link.routing ?? 'straight'} onChange={(e) => { set('routing', e.target.value as 'straight' | 'orthogonal'); endEdit(); }}>
            <option value="straight">Straight</option>
            <option value="orthogonal">Orthogonal (elbow)</option>
          </select>
        </Field>
        {(link.waypoints?.length ?? 0) > 0 && (
          <Field label="Waypoints">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={styles.readonly}>{link.waypoints!.length}</span>
              <button
                className={styles.openBtn ?? ''}
                style={{ border: '1px solid var(--chrome-border)', background: 'transparent', color: 'var(--chrome-fg)', borderRadius: 5, padding: '3px 8px', fontSize: 11 }}
                onClick={() => { set('waypoints', []); endEdit(); }}
              >
                Clear
              </button>
            </div>
          </Field>
        )}
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Endpoints</div>
        <Field label="Source">
          <div className={styles.readonly}>{source?.name ?? '(missing)'}</div>
        </Field>
        <Field label="Source interface">
          <input value={link.sourceInterface ?? ''} placeholder="Gi0/1" onChange={(e) => set('sourceInterface', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Target">
          <div className={styles.readonly}>{target?.name ?? '(missing)'}</div>
        </Field>
        <Field label="Target interface">
          <input value={link.targetInterface ?? ''} placeholder="Gi0/2" onChange={(e) => set('targetInterface', e.target.value)} onBlur={endEdit} />
        </Field>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>VLAN / Trunk</div>
        <Field label="Mode">
          <select value={link.mode ?? ''} onChange={(e) => { set('mode', (e.target.value || undefined) as Link['mode']); endEdit(); }}>
            <option value="">—</option>
            <option value="access">Access</option>
            <option value="trunk">Trunk</option>
          </select>
        </Field>
        <Field label="VLANs carried">
          <input value={link.vlan ?? ''} placeholder="10,20,30" onChange={(e) => set('vlan', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Native VLAN">
          <input value={link.nativeVlan ?? ''} placeholder="1" onChange={(e) => set('nativeVlan', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="LACP / port-channel">
          <input value={link.lacp ?? ''} placeholder="Po1" onChange={(e) => set('lacp', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Circuit ID">
          <input value={link.circuitId ?? ''} onChange={(e) => set('circuitId', e.target.value)} onBlur={endEdit} />
        </Field>
      </div>
    </>
  );
}

function ObjectInspector({ object }: { object: CanvasObject }) {
  const updateObject = useProjectStore((s) => s.updateObject);
  const endEdit = useProjectStore((s) => s.endEdit);
  // Patch form: keyof CanvasObject is only the common keys, so take a partial.
  function set(after: Record<string, unknown>) {
    const before: Record<string, unknown> = {};
    const o = object as unknown as Record<string, unknown>;
    for (const k of Object.keys(after)) before[k] = o[k];
    updateObject(object.id, before as Partial<CanvasObject>, after as Partial<CanvasObject>);
  }
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>
        {object.kind === 'text' ? 'Text' : object.kind === 'image' ? 'Image / underlay' : 'Shape / Zone'}
      </div>
      {object.kind === 'text' && (
        <>
          <Field label="Text">
            <textarea value={object.text} onChange={(e) => set({ text: e.target.value })} onBlur={endEdit} />
          </Field>
          <Field label="Font size">
            <input
              type="number"
              value={object.fontSize ?? 14}
              onChange={(e) => set({ fontSize: Number(e.target.value) })}
              onBlur={endEdit}
            />
          </Field>
          <Field label="Color">
            <input type="color" value={object.color ?? '#1c2733'} onChange={(e) => { set({ color: e.target.value }); endEdit(); }} />
          </Field>
        </>
      )}
      {object.kind === 'shape' && (
        <>
          <Field label="Label">
            <input value={object.label ?? ''} onChange={(e) => set({ label: e.target.value })} onBlur={endEdit} />
          </Field>
          <Field label="Shape">
            <select value={object.shape} onChange={(e) => { set({ shape: e.target.value }); endEdit(); }}>
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </Field>
          <Field label="Fill">
            <input type="color" value={object.fill ?? '#2563eb'} onChange={(e) => { set({ fill: e.target.value }); endEdit(); }} />
          </Field>
          <Field label="Border">
            <input type="color" value={object.stroke ?? '#2563eb'} onChange={(e) => { set({ stroke: e.target.value }); endEdit(); }} />
          </Field>
        </>
      )}
      {object.kind === 'image' && (
        <Field label="Opacity">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={object.opacity ?? 1}
            onChange={(e) => { set({ opacity: Number(e.target.value) }); endEdit(); }}
          />
        </Field>
      )}
    </div>
  );
}

function ProjectInspector() {
  const projectName = useProjectStore((s) => s.projectName);
  const rename = useProjectStore((s) => s.renameProject);
  const endEdit = useProjectStore((s) => s.endEdit);
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Project</div>
      <Field label="Name">
        <input value={projectName} onChange={(e) => rename(projectName, e.target.value)} onBlur={endEdit} />
      </Field>
      <div className={styles.empty} style={{ padding: '4px 0' }}>
        Select a device or link to edit its properties.
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      {children}
      {error && <div className={styles.fieldError}>{error}</div>}
    </div>
  );
}

export function Inspector() {
  // rev drives refresh when the selected object's fields change.
  useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const store = useProjectStore.getState;
  const ids = [...selection];

  let body: React.ReactNode;
  let head = 'Project';
  let sub = '';

  if (ids.length === 0) {
    body = <ProjectInspector />;
  } else if (ids.length === 1) {
    const id = ids[0]!;
    const device = store().getDevice(id);
    if (device) {
      head = device.name || defaultDeviceName(device.type);
      sub = defaultDeviceName(device.type);
      body = <DeviceInspector device={device} />;
    } else {
      const link = store().getLink(id);
      const object = store().getObject(id);
      if (link) {
        head = link.name || 'Link';
        sub = 'Connection';
        body = <LinkInspector link={link} />;
      } else if (object) {
        head =
          object.kind === 'text'
            ? 'Text note'
            : object.kind === 'image'
              ? 'Image underlay'
              : object.label || 'Shape';
        sub = object.kind === 'text' ? 'Note' : object.kind === 'image' ? 'Underlay' : 'Zone / shape';
        body = <ObjectInspector object={object} />;
      } else {
        body = <ProjectInspector />;
      }
    }
  } else {
    head = `${ids.length} selected`;
    body = (
      <div className={styles.empty}>
        {ids.length} objects selected. Press Delete to remove them, or drag to move
        together. Per-field multi-edit comes later.
      </div>
    );
  }

  return (
    <div className={styles.inspector}>
      <div className={styles.header}>
        {head}
        {sub && <span className={styles.subhead}> · {sub}</span>}
      </div>
      <div className={styles.scroll}>{body}</div>
    </div>
  );
}
