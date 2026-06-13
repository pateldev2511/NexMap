import { useProjectStore } from '@/store/projectStore';
import type { CanvasObject, Device, DeviceType, Link } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import { isValidIp, isValidCidr } from '@/lib/ipcidr';
import { nextFreeHost } from '@/lib/ipam';
import { defaultDeviceName } from '@/model/schema';
import { VENDORS, MODELS, ROLES } from '@/lib/deviceCatalog';
import { MIN_LINK_WIDTH, MAX_LINK_WIDTH, DEFAULT_LINK_WIDTH } from '@/canvas/connector';
import { parseVlanId, VLAN_MIN, VLAN_MAX } from '@/rack/vlan';
import {
  MIN_ICON_SCALE,
  MAX_ICON_SCALE,
  DEFAULT_ICON_SCALE,
  MIN_LABEL_HEIGHT,
  MAX_LABEL_HEIGHT,
  DEFAULT_LABEL_HEIGHT,
} from '@/canvas/nodeCard';
import { RichTextEditor } from './RichTextEditor';
import { ComboBox } from './ComboBox';
import styles from './Inspector.module.css';

/**
 * Properties inspector (design review DA-DES-4.1). Grouped fields, MVP subset
 * (~8 device fields), undoable edits with inline validation. Single selection →
 * full detail; multi → count + shared delete; empty → project properties.
 */

const DEVICE_TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'access-point',
  'wireless-controller',
  'server',
  'storage',
  'load-balancer',
  'end-user',
  'printer',
  'iot',
  'isp',
  'cloud',
  'vm',
  'container',
  'rack',
  'patch-panel',
  'ups',
  'camera',
  'vpc',
  'cloud-subnet',
  'internet-gateway',
  'nat-gateway',
  'route-table',
  'security-group',
  'vpn-gateway',
  'k8s',
  'managed-db',
  'object-storage',
  'generic',
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
    updateDevice(
      device.id,
      { [key]: device[key] } as Partial<Device>,
      {
        [key]: value,
      } as Partial<Device>,
    );
  }

  const mgmtErr = ipError(device.managementIp);
  const subnetCount = useProjectStore((s) => s.subnetsAll().length);

  /** Allocate the lowest free host from the first subnet with room. */
  function suggestIp() {
    const st = useProjectStore.getState();
    const subnets = st.subnetsAll();
    const others = st
      .devicesAll()
      .filter((d) => d.id !== device.id)
      .map((d) => d.managementIp)
      .filter((ip): ip is string => !!ip);
    for (const subnet of subnets) {
      const host = nextFreeHost(subnet.cidr, others, { gateway: subnet.gateway });
      if (host) {
        set('managementIp', host);
        endEdit();
        return;
      }
    }
  }

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
          <select
            value={device.type}
            onChange={(e) => {
              set('type', e.target.value as DeviceType);
              endEdit();
            }}
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {defaultDeviceName(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendor">
          <ComboBox
            value={device.vendor ?? ''}
            options={VENDORS}
            placeholder="Pick or type a vendor"
            ariaLabel="Vendor"
            onChange={(v) => set('vendor', v)}
            onCommit={endEdit}
          />
        </Field>
        <Field label="Model">
          <ComboBox
            value={device.model ?? ''}
            options={MODELS}
            placeholder="Pick or type a model"
            ariaLabel="Model"
            onChange={(v) => set('model', v)}
            onCommit={endEdit}
          />
        </Field>
        <Field label="Role">
          <ComboBox
            value={device.role ?? ''}
            options={ROLES}
            placeholder="Pick or type a role"
            ariaLabel="Role"
            onChange={(v) => set('role', v)}
            onCommit={endEdit}
          />
        </Field>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Appearance</div>
        <Field label="Icon size">
          <div className={styles.ipRow}>
            <input
              type="range"
              min={MIN_ICON_SCALE}
              max={MAX_ICON_SCALE}
              step={0.05}
              value={device.iconScale ?? DEFAULT_ICON_SCALE}
              onChange={(e) => set('iconScale', Number(e.target.value))}
              onPointerUp={endEdit}
              aria-label="Icon size"
              style={{ flex: '1 1 auto' }}
            />
            <span
              style={{ minWidth: 40, textAlign: 'right', fontSize: 11, color: 'var(--chrome-fg-muted)' }}
            >
              {Math.round((device.iconScale ?? DEFAULT_ICON_SCALE) * 100)}%
            </span>
          </div>
        </Field>
        <Field label="Label height">
          <div className={styles.ipRow}>
            <input
              type="range"
              min={MIN_LABEL_HEIGHT}
              max={MAX_LABEL_HEIGHT}
              step={2}
              value={device.labelHeight ?? DEFAULT_LABEL_HEIGHT}
              onChange={(e) => set('labelHeight', Number(e.target.value))}
              onPointerUp={endEdit}
              aria-label="Label height"
              style={{ flex: '1 1 auto' }}
            />
            <span
              style={{ minWidth: 40, textAlign: 'right', fontSize: 11, color: 'var(--chrome-fg-muted)' }}
            >
              {Math.round(device.labelHeight ?? DEFAULT_LABEL_HEIGHT)}px
            </span>
          </div>
        </Field>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Network</div>
        <Field label="Management IP" error={mgmtErr}>
          <div className={styles.ipRow}>
            <input
              className={mgmtErr ? styles.invalid : ''}
              value={device.managementIp ?? ''}
              placeholder="10.0.0.1 or 10.0.0.1/24"
              onChange={(e) => set('managementIp', e.target.value)}
              onBlur={endEdit}
            />
            <button
              type="button"
              className={styles.suggestBtn}
              onClick={suggestIp}
              disabled={subnetCount === 0}
              title={
                subnetCount === 0
                  ? 'Add a subnet (IP Plan) to suggest an address'
                  : 'Suggest the next free host from your subnets'
              }
            >
              Suggest
            </button>
          </div>
        </Field>
      </div>

      <InterfacesSection device={device} />

      <RackFields device={device} set={set} endEdit={endEdit} />

      <div className={styles.group}>
        <div className={styles.groupTitle}>Lifecycle & asset</div>
        <Field label="Status">
          <select
            value={device.status ?? 'active'}
            onChange={(e) => set('status', (e.target.value === 'active' ? undefined : e.target.value) as Device['status'])}
            onBlur={endEdit}
          >
            <option value="active">Active</option>
            <option value="planned">Planned</option>
            <option value="maintenance">Maintenance</option>
            <option value="decommissioned">Decommissioned</option>
          </select>
        </Field>
        <Field label="Serial">
          <input value={device.serial ?? ''} onChange={(e) => set('serial', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Asset tag">
          <input value={device.assetTag ?? ''} onChange={(e) => set('assetTag', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Owner">
          <input value={device.owner ?? ''} onChange={(e) => set('owner', e.target.value)} onBlur={endEdit} />
        </Field>
        <Field label="Warranty expiry">
          <input type="date" value={device.warrantyExpiry ?? ''} onChange={(e) => set('warrantyExpiry', e.target.value)} onBlur={endEdit} />
        </Field>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Location & Notes</div>
        <Field label="Location">
          <input
            value={device.location ?? ''}
            onChange={(e) => set('location', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="Description">
          <RichTextEditor
            value={device.descriptionHtml ?? ''}
            onChange={(html) => set('descriptionHtml', html)}
            onCommit={endEdit}
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={device.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
      </div>
    </>
  );
}

function InterfacesSection({ device }: { device: Device }) {
  const addInterface = useProjectStore((s) => s.addInterface);
  const updateInterface = useProjectStore((s) => s.updateInterface);
  const deleteInterface = useProjectStore((s) => s.deleteInterface);
  const endEdit = useProjectStore((s) => s.endEdit);
  const interfaces = device.interfaces ?? [];

  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Interfaces</div>
      {interfaces.length === 0 && (
        <div className={styles.ifaceEmpty}>
          No interfaces yet. Add ports to attach links to specific endpoints.
        </div>
      )}
      {interfaces.map((iface) => (
        <div key={iface.id} className={styles.ifaceRow}>
          <input
            value={iface.name}
            placeholder="Gi0/1"
            aria-label="Interface name"
            onChange={(e) => updateInterface(device.id, iface.id, { name: e.target.value })}
            onBlur={endEdit}
          />
          <input
            className={styles.ifaceSpeed}
            value={iface.speed ?? ''}
            placeholder="speed"
            aria-label="Interface speed"
            onChange={(e) => updateInterface(device.id, iface.id, { speed: e.target.value })}
            onBlur={endEdit}
          />
          <input
            className={styles.ifaceVlan}
            value={iface.vlan ?? ''}
            type="number"
            min={VLAN_MIN}
            max={VLAN_MAX}
            placeholder="VLAN"
            aria-label="Port VLAN id"
            title="Access VLAN (1–4094)"
            onChange={(e) => updateInterface(device.id, iface.id, { vlan: parseVlanId(e.target.value) })}
            onBlur={endEdit}
          />
          <button
            type="button"
            className={styles.ifaceDel}
            onClick={() => deleteInterface(device.id, iface.id)}
            aria-label={`Delete interface ${iface.name}`}
            title="Delete interface"
          >
            <NexIcon name="close" />
          </button>
        </div>
      ))}
      <button type="button" className={styles.ifaceAdd} onClick={() => addInterface(device.id)}>
        <NexIcon name="plus" />
        <span>Add interface</span>
      </button>
    </div>
  );
}

function IfacePicker({
  device,
  value,
  fallbackLabel,
  onChange,
}: {
  device: Device | undefined;
  value: string | undefined;
  fallbackLabel: string | undefined;
  onChange: (value: string) => void;
}) {
  const interfaces = device?.interfaces ?? [];
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={!device}>
      <option value="">{fallbackLabel ? `(none — was "${fallbackLabel}")` : '(none)'}</option>
      {interfaces.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
      <option value="__add">+ Add interface…</option>
    </select>
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
        <select
          value={device.rackId ?? ''}
          onChange={(e) => {
            set('rackId', e.target.value || undefined);
            endEdit();
          }}
        >
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

  const addInterface = useProjectStore((s) => s.addInterface);

  function set<K extends keyof Link>(key: K, value: Link[K]) {
    updateLink(
      link.id,
      { [key]: link[key] } as Partial<Link>,
      { [key]: value } as Partial<Link>,
    );
  }

  /**
   * Assign (or clear) an endpoint's interface. Sets the id reference AND mirrors the
   * interface name into the free-text label so connector labels and CSV export stay in
   * sync. "__add" mints a new interface on the device and assigns it. One undoable edit.
   */
  function setEndpointIface(end: 'source' | 'target', value: string) {
    const device = end === 'source' ? source : target;
    if (!device) return;
    const idKey = end === 'source' ? 'sourceIfaceId' : 'targetIfaceId';
    const labelKey = end === 'source' ? 'sourceInterface' : 'targetInterface';
    let ifaceId: string | undefined = value || undefined;
    if (value === '__add') {
      ifaceId = addInterface(device.id) ?? undefined;
    }
    // Read fresh state so a just-added interface's name is found.
    const fresh = useProjectStore.getState().getDevice(device.id);
    const name = ifaceId ? fresh?.interfaces?.find((i) => i.id === ifaceId)?.name : undefined;
    updateLink(
      link.id,
      { [idKey]: link[idKey], [labelKey]: link[labelKey] } as Partial<Link>,
      { [idKey]: ifaceId, [labelKey]: name } as Partial<Link>,
    );
    endEdit();
  }

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Link</div>
        <Field label="Name">
          <input
            value={link.name ?? ''}
            onChange={(e) => set('name', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="Type">
          <input
            value={link.linkType ?? ''}
            placeholder="ethernet, fiber…"
            onChange={(e) => set('linkType', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="Bandwidth">
          <input
            value={link.bandwidth ?? ''}
            placeholder="1G, 10G…"
            onChange={(e) => set('bandwidth', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Connector</div>
        <Field label="Line">
          <select
            value={link.style ?? 'solid'}
            onChange={(e) => {
              set('style', e.target.value as 'solid' | 'dashed');
              endEdit();
            }}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </Field>
        <Field label="Arrows">
          <select
            value={link.arrow ?? 'end'}
            onChange={(e) => {
              set('arrow', e.target.value as 'none' | 'end' | 'both');
              endEdit();
            }}
          >
            <option value="none">None</option>
            <option value="end">End</option>
            <option value="both">Both ends</option>
          </select>
        </Field>
        <Field label="Routing">
          <select
            value={link.routing ?? 'straight'}
            onChange={(e) => {
              set('routing', e.target.value as 'straight' | 'orthogonal');
              endEdit();
            }}
          >
            <option value="straight">Straight</option>
            <option value="orthogonal">Orthogonal (elbow)</option>
          </select>
        </Field>
        <Field label="Auto-route">
          <button
            type="button"
            className={styles.suggestBtn}
            onClick={() => useProjectStore.getState().rerouteSelectedLinks()}
            title="Route this connector around other devices"
          >
            Route around obstacles
          </button>
        </Field>
        <Field label="Color">
          <div className={styles.ipRow}>
            <input
              type="color"
              value={link.color ?? '#94a3b8'}
              onChange={(e) => set('color', e.target.value)}
              onBlur={endEdit}
              aria-label="Link color"
            />
            <button
              type="button"
              className={styles.suggestBtn}
              disabled={!link.color}
              onClick={() => {
                set('color', undefined);
                endEdit();
              }}
              title="Clear manual color — fall back to health tint / default"
            >
              Auto
            </button>
          </div>
        </Field>
        <Field label="Width">
          <div className={styles.ipRow}>
            <input
              type="range"
              min={MIN_LINK_WIDTH}
              max={MAX_LINK_WIDTH}
              step={0.5}
              value={link.width ?? DEFAULT_LINK_WIDTH}
              onChange={(e) => set('width', Number(e.target.value))}
              onPointerUp={endEdit}
              aria-label="Link thickness"
              style={{ flex: '1 1 auto' }}
            />
            <span style={{ minWidth: 34, textAlign: 'right', fontSize: 11, color: 'var(--chrome-fg-muted)' }}>
              {(link.width ?? DEFAULT_LINK_WIDTH).toFixed(1)}px
            </span>
          </div>
        </Field>
        {(link.waypoints?.length ?? 0) > 0 && (
          <Field label="Waypoints">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={styles.readonly}>{link.waypoints!.length}</span>
              <button
                className={styles.openBtn ?? ''}
                style={{
                  border: '1px solid var(--chrome-border)',
                  background: 'transparent',
                  color: 'var(--chrome-fg)',
                  borderRadius: 5,
                  padding: '3px 8px',
                  fontSize: 11,
                }}
                onClick={() => {
                  set('waypoints', []);
                  endEdit();
                }}
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
          <IfacePicker
            device={source}
            value={link.sourceIfaceId}
            fallbackLabel={link.sourceInterface}
            onChange={(v) => setEndpointIface('source', v)}
          />
        </Field>
        <Field label="Target">
          <div className={styles.readonly}>{target?.name ?? '(missing)'}</div>
        </Field>
        <Field label="Target interface">
          <IfacePicker
            device={target}
            value={link.targetIfaceId}
            fallbackLabel={link.targetInterface}
            onChange={(v) => setEndpointIface('target', v)}
          />
        </Field>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>VLAN / Trunk</div>
        <Field label="Mode">
          <select
            value={link.mode ?? ''}
            onChange={(e) => {
              set('mode', (e.target.value || undefined) as Link['mode']);
              endEdit();
            }}
          >
            <option value="">—</option>
            <option value="access">Access</option>
            <option value="trunk">Trunk</option>
          </select>
        </Field>
        <Field label="VLANs carried">
          <input
            value={link.vlan ?? ''}
            placeholder="10,20,30"
            onChange={(e) => set('vlan', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="Native VLAN">
          <input
            value={link.nativeVlan ?? ''}
            placeholder="1"
            onChange={(e) => set('nativeVlan', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="LACP / port-channel">
          <input
            value={link.lacp ?? ''}
            placeholder="Po1"
            onChange={(e) => set('lacp', e.target.value)}
            onBlur={endEdit}
          />
        </Field>
        <Field label="Circuit ID">
          <input
            value={link.circuitId ?? ''}
            onChange={(e) => set('circuitId', e.target.value)}
            onBlur={endEdit}
          />
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
    updateObject(
      object.id,
      before as Partial<CanvasObject>,
      after as Partial<CanvasObject>,
    );
  }
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>
        {object.kind === 'text'
          ? 'Text'
          : object.kind === 'image'
            ? 'Image / underlay'
            : 'Shape / Zone'}
      </div>
      {object.kind === 'text' && (
        <>
          <Field label="Heading">
            <input
              value={object.heading ?? ''}
              placeholder="(optional title)"
              onChange={(e) => set({ heading: e.target.value || undefined })}
              onBlur={endEdit}
            />
          </Field>
          <Field label="Subheading">
            <input
              value={object.subheading ?? ''}
              placeholder="(optional subtitle)"
              onChange={(e) => set({ subheading: e.target.value || undefined })}
              onBlur={endEdit}
            />
          </Field>
          <Field label="Body">
            <textarea
              value={object.text}
              onChange={(e) => set({ text: e.target.value })}
              onBlur={endEdit}
            />
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
            <input
              type="color"
              value={object.color ?? '#1c2733'}
              onChange={(e) => {
                set({ color: e.target.value });
                endEdit();
              }}
            />
          </Field>
        </>
      )}
      {object.kind === 'shape' && (
        <>
          <Field label="Label">
            <input
              value={object.label ?? ''}
              onChange={(e) => set({ label: e.target.value })}
              onBlur={endEdit}
            />
          </Field>
          <Field label="Shape">
            <select
              value={object.shape}
              onChange={(e) => {
                set({ shape: e.target.value });
                endEdit();
              }}
            >
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </Field>
          <Field label="Fill">
            <input
              type="color"
              value={object.fill ?? '#2563eb'}
              onChange={(e) => {
                set({ fill: e.target.value });
                endEdit();
              }}
            />
          </Field>
          <Field label="Border">
            <input
              type="color"
              value={object.stroke ?? '#2563eb'}
              onChange={(e) => {
                set({ stroke: e.target.value });
                endEdit();
              }}
            />
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
            onChange={(e) => {
              set({ opacity: Number(e.target.value) });
              endEdit();
            }}
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
        <input
          value={projectName}
          onChange={(e) => rename(projectName, e.target.value)}
          onBlur={endEdit}
        />
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
        sub =
          object.kind === 'text'
            ? 'Note'
            : object.kind === 'image'
              ? 'Underlay'
              : 'Zone / shape';
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
