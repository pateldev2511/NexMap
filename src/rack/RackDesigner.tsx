import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { createInterface, defaultDeviceName } from '@/model/schema';
import { rasterize, downloadBlob } from '@/io/export/raster';
import { buildPdfBlob } from '@/io/export/pdf';
import { RackCanvas, type RejectInfo } from './RackCanvas';
import { ConnectPortsDialog } from './ConnectPortsDialog';
import { buildRackSvg, cableScheduleCsv } from './buildRackSvg';
import { slotOf, canFit, nearestFreeU, type FitResult } from './rackModel';
import { RACK_DEVICE_PRESETS, RACK_PRESET_GROUPS, type RackDevicePreset } from './rackDevicePresets';
import { RACK_PRESETS, rackFieldsFromPreset, DEFAULT_RACK_PRESET } from './rackTypes';
import styles from './RackDesigner.module.css';

/** Human-readable reason for a rejected drop. */
function rejectReason(fit: FitResult): string {
  if (fit.ok) return '';
  switch (fit.reason) {
    case 'occupied':
      return 'That U is occupied';
    case 'bay-conflict':
      return 'That half-bay is taken';
    case 'out-of-bounds':
      return "Won't fit there";
    default:
      return 'Invalid slot';
  }
}

/**
 * Rack elevation designer (schema v3). Replaces the toy RackView. Click a library
 * preset to arm it, click a U slot to drop (auto-populated ports), click a device to
 * select, drag it vertically to reposition. List-first cabling. Export PNG + CSV.
 */
export function RackDesigner() {
  useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const s = useProjectStore.getState;

  const racks = s().racksAll();
  const [rackId, setRackId] = useState<string>(racks[0]?.id ?? '');
  const rack = racks.find((r) => r.id === rackId) ?? racks[0];
  const [armed, setArmed] = useState<RackDevicePreset | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [newType, setNewType] = useState<string>(DEFAULT_RACK_PRESET.id);
  const [reject, setReject] = useState<RejectInfo | null>(null);
  const [side, setSideState] = useState<'front' | 'rear'>('front');
  const [bay, setBay] = useState<'full' | 'left' | 'right'>('full');
  const [selCable, setSelCable] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const devices = s().devicesAll();
  const cables = s().rackCablesAll();
  const selectedId = [...selection][0] ?? null;
  const selected = selectedId ? devices.find((d) => d.id === selectedId) : undefined;
  const inRack = useMemo(() => devices.filter((d) => d.rackId === rack?.id), [devices, rack?.id]);
  const usedU = useMemo(
    () => inRack.filter((d) => (d.mount ?? 'rack') === 'rack').reduce((sum, d) => sum + (d.ruSpan ?? 1), 0),
    [inRack],
  );
  // Device counts per face — surfaced on the Front/Rear toggle so flipping to an empty
  // face never looks like your gear vanished.
  const faceCounts = useMemo(() => {
    let front = 0;
    let rear = 0;
    for (const d of inRack) {
      if (slotOf(d).side === 'rear') rear++;
      else front++;
    }
    return { front, rear };
  }, [inRack]);

  /** Switch faces and drop any selection that belongs to the face we're leaving. */
  function setSide(next: 'front' | 'rear') {
    if (next === side) return;
    setSideState(next);
    setSelCable(null);
    // Clear a device selection that isn't on the new face (avoids a stale inspector).
    if (selected && slotOf(selected).side !== next) s().select([]);
  }

  // Keyboard: ↑/↓ nudge selected device a U, Delete removes it, Esc clears. Declared
  // BEFORE the no-racks early return so the hook order is stable across renders;
  // nudge()/deleteSelected() are hoisted function declarations, safe to reference here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        setArmed(null);
        setSelCable(null);
        s().select([]);
        return;
      }
      if (!selectedId) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected, rack]);

  // ── No racks yet: warm empty state ─────────────────────────────────────────
  if (!rack) {
    return (
      <div className={styles.root} style={{ gridTemplateColumns: '1fr' }}>
        <div className={styles.toolbar}>
          <span className={styles.title}>Rack designer</span>
        </div>
        <div className={styles.stage}>
          <div className={styles.hint}>
            No racks yet. Pick a rack type and start mounting gear.
            <div className={styles.cta}>
              <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                {RACK_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>{' '}
              <button className={`${styles.btn} ${styles.primary}`} onClick={createRack}>+ New rack</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function createRack() {
    const preset = RACK_PRESETS.find((p) => p.id === newType) ?? DEFAULT_RACK_PRESET;
    const id = s().addRack(preset.label.split(' · ')[0] ?? 'Rack');
    s().updateRack(id, {}, rackFieldsFromPreset(preset));
    setRackId(id);
  }

  /** Shared by click-to-place AND drag-and-drop: validate, then create + mount, or reject. */
  function placePreset(preset: RackDevicePreset, u: number) {
    if (!rack) return;
    const span = preset.span;
    const mount = preset.mount ?? 'rack';
    const useBay = mount === 'rail' ? 'full' : bay; // rail items span the channel
    const slot = {
      ru: Math.min(u, rack.ruHeight - span + 1),
      ruSpan: span,
      mount,
      side,
      bay: useBay,
    };
    const occ = devices.filter((d) => d.rackId === rack.id);
    // Pre-check BEFORE creating anything — never leave an orphan device on rejection.
    const fit = canFit(rack, occ, slot);
    if (!fit.ok) {
      setReject({
        u: slot.ru,
        span,
        reason: rejectReason(fit),
        pulseU: nearestFreeU(rack, occ, span, slot.ru, side, useBay),
      });
      window.setTimeout(() => setReject(null), 2400);
      return;
    }
    setReject(null);
    // Create the device, give it a DISTINGUISHABLE auto-numbered name (so the cable
    // schedule reads "sw-01:Gi1/0/1", not five identical "Switch" rows), auto-populate
    // ports, all in one undoable edit, then place it.
    const base = defaultDeviceName(preset.type);
    const used = new Set(devices.map((d) => d.name));
    let n = devices.filter((d) => d.name === base || d.name.startsWith(`${base} `)).length + 1;
    while (used.has(`${base} ${n}`)) n++;
    const name = `${base} ${n}`;
    const id = s().addDeviceAt(preset.type, -9999, -9999);
    const ifaces = preset.ports > 0
      ? Array.from({ length: preset.ports }, (_, i) => createInterface(preset.portName(i)))
      : [];
    s().updateDevice(id, { name: base, interfaces: [] }, { name, interfaces: ifaces });
    s().placeInRack(id, rack.id, slot);
    s().select([id]);
  }

  /** Click-to-place: drop the currently armed preset at U, then disarm. */
  function placeAt(u: number) {
    if (!armed) return;
    placePreset(armed, u);
    setArmed(null);
  }

  /** Drag-and-drop: drop a specific preset (by key) at U. Arming is irrelevant. */
  function dropPreset(key: string, u: number) {
    const preset = RACK_DEVICE_PRESETS.find((p) => p.key === key);
    if (preset) placePreset(preset, u);
  }

  function moveTo(id: string, u: number) {
    if (!rack) return;
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    const slot = slotOf(d);
    s().placeInRack(id, rack.id, { ...slot, ru: Math.min(u, rack.ruHeight - slot.ruSpan + 1) });
  }

  /** Nudge the selected device by ±1U (keyboard / inspector). No-op if it can't move. */
  function nudge(delta: number) {
    if (!rack || !selected) return;
    const cur = slotOf(selected).ru;
    const next = Math.max(1, Math.min(rack.ruHeight - slotOf(selected).ruSpan + 1, cur + delta));
    if (next !== cur) moveTo(selected.id, next);
  }
  function deleteSelected() {
    if (!selected) return;
    s().select([selected.id]);
    s().deleteSelection();
  }
  function renameSelected(name: string) {
    if (!selected) return;
    s().updateDevice(selected.id, { name: selected.name }, { name });
  }

  function exportPng() {
    if (!rack) return;
    const svg = buildRackSvg(rack, devices, cables, { background: '#0c1015', side });
    rasterize(svg, { scale: 2, mimeType: 'image/png', background: null })
      .then(({ blob }) => downloadBlob(blob, `${rack.name}-rack.png`))
      .catch(() => undefined);
  }
  function exportPdf() {
    if (!rack) return;
    const svg = buildRackSvg(rack, devices, cables, { background: '#ffffff', side });
    buildPdfBlob(svg, { pageSize: 'a4', orientation: 'portrait', scale: 2 })
      .then((blob) => downloadBlob(blob, `${rack.name}-rack.pdf`))
      .catch(() => undefined);
  }
  function exportCsv() {
    if (!rack) return;
    const csv = cableScheduleCsv(devices, cables);
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `${rack.name}-cables.csv`);
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Rack designer</span>
        <select value={rack.id} onChange={(e) => setRackId(e.target.value)}>
          {racks.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.ruHeight}U</option>)}
        </select>
        <button className={styles.btn} onClick={createRack}>+ Rack</button>
        <div className={styles.seg} title="Mounting face — devices on opposite faces don't collide. Counts show what's on each side.">
          <button className={side === 'front' ? styles.on : ''} onClick={() => setSide('front')}>
            Front{faceCounts.front > 0 && <span className={styles.badge}>{faceCounts.front}</span>}
          </button>
          <button className={side === 'rear' ? styles.on : ''} onClick={() => setSide('rear')}>
            Rear{faceCounts.rear > 0 && <span className={styles.badge}>{faceCounts.rear}</span>}
          </button>
        </div>
        {armed && (armed.mount ?? 'rack') === 'rack' && (
          <div className={styles.seg} title="Half-width bay: two devices share one U">
            <button className={bay === 'full' ? styles.on : ''} onClick={() => setBay('full')}>Full</button>
            <button className={bay === 'left' ? styles.on : ''} onClick={() => setBay('left')}>L</button>
            <button className={bay === 'right' ? styles.on : ''} onClick={() => setBay('right')}>R</button>
          </div>
        )}
        <div className={styles.spacer} />
        <span className={styles.stat}>{usedU} / {rack.ruHeight}U</span>
        <button className={styles.btn} onClick={exportCsv}>Cable CSV</button>
        <button className={styles.btn} onClick={exportPdf}>PDF</button>
        <button className={`${styles.btn} ${styles.primary}`} onClick={exportPng}>Export PNG</button>
      </div>

      {/* library */}
      <div className={styles.lib}>
        <input
          className={styles.libSearch}
          placeholder="Search gear…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search device library"
        />
        {RACK_PRESET_GROUPS.map((group) => {
          const items = RACK_DEVICE_PRESETS.filter(
            (p) => p.group === group && p.label.toLowerCase().includes(search.trim().toLowerCase()),
          );
          if (items.length === 0) return null;
          return (
          <div key={group}>
            <h4>{group}</h4>
            {items.map((p) => (
              <button
                key={p.key}
                className={`${styles.chip} ${armed?.key === p.key ? styles.armed : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/rack-preset', p.key);
                  e.dataTransfer.effectAllowed = 'copy';
                  setReject(null);
                }}
                onClick={() => {
                  setReject(null);
                  setArmed(armed?.key === p.key ? null : p);
                }}
                aria-pressed={armed?.key === p.key}
                title={`Click to arm, or drag onto a slot — ${p.label}`}
              >
                <span className={styles.glyph}>
                  {Array.from({ length: Math.min(6, Math.max(1, Math.round(p.ports / 8))) }, (_, i) => <i key={i} />)}
                </span>
                <span>{p.label}</span>
                <span className={styles.u}>{p.span}U</span>
              </button>
            ))}
          </div>
          );
        })}
      </div>

      {/* canvas */}
      <div className={`${styles.stage} ${armed ? styles.placing : ''}`}>
        <RackCanvas
          rack={rack}
          devices={devices}
          cables={cables}
          selectedId={selectedId}
          selectedCableId={selCable}
          side={side}
          armed={armed != null}
          reject={reject}
          onPlaceAt={placeAt}
          onDropPreset={dropPreset}
          onSelect={(id) => s().select(id ? [id] : [])}
          onSelectCable={setSelCable}
          onMoveTo={moveTo}
        />
      </div>

      {/* sidebar */}
      <div className={styles.side}>
        <div className={styles.sec}>
          <h3>{selected ? 'Selected device' : 'Nothing selected'}</h3>
          {selected ? (
            <>
              <input
                className={styles.nameInput}
                value={selected.name}
                aria-label="Device name"
                onChange={(e) => renameSelected(e.target.value)}
                onBlur={() => s().endEdit()}
              />
              <div className={styles.kv}><span>Type</span><b>{selected.type}</b></div>
              <div className={styles.kv}><span>Position</span><b>U{selected.ru} · {slotOf(selected).side}</b></div>
              <div className={styles.kv}><span>Ports</span><b>{selected.interfaces?.length ?? 0}</b></div>
              <div className={styles.rowBtns}>
                <button className={styles.btn} title="Move up 1U (↑)" onClick={() => nudge(1)}>↑ U</button>
                <button className={styles.btn} title="Move down 1U (↓)" onClick={() => nudge(-1)}>↓ U</button>
                <button className={styles.btn} title="Unmount to the tray" onClick={() => { s().select([selected.id]); s().unmountFromRack(selected.id); }}>Unmount</button>
                <button className={styles.btn} title="Delete (⌫)" onClick={deleteSelected}>Delete</button>
              </div>
              <button className={styles.connectBtn} style={{ marginTop: 8 }} onClick={() => setConnecting(true)}>+ Cable a port…</button>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--chrome-fg-muted)' }}>
              {armed
                ? `Click a U slot to drop ${armed.label} — or drag it from the left.`
                : 'Click a device to edit it. Pick or drag gear from the left to add. Arrow keys move, ⌫ deletes.'}
            </div>
          )}
        </div>
        <div className={styles.sec} style={{ flex: 1 }}>
          <h3>Cable schedule · {cables.length}</h3>
          {cables.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--chrome-fg-muted)' }}>No cables yet.</div>
          )}
          {cables.map((c) => {
            const a = devices.find((d) => d.id === c.aEnd.deviceId);
            const b = devices.find((d) => d.id === c.bEnd.deviceId);
            const pn = (dev: typeof a, ifId: string) => dev?.interfaces?.find((i) => i.id === ifId)?.name ?? ifId;
            return (
              <div
                key={c.id}
                className={`${styles.cable} ${selCable === c.id ? styles.cableOn : ''}`}
                onMouseEnter={() => setSelCable(c.id)}
                onClick={() => setSelCable(selCable === c.id ? null : c.id)}
              >
                <span className={styles.sw} style={{ background: c.color }} />
                <span className={styles.ep}>{a?.name}:{pn(a, c.aEnd.ifaceId)} → {b?.name}:{pn(b, c.bEnd.ifaceId)}</span>
                {c.label && <span className={styles.lbl}>{c.label}</span>}
                <button
                  className={styles.x}
                  aria-label="Remove cable"
                  onClick={(e) => { e.stopPropagation(); s().disconnectRackCable(c.id); }}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button className={styles.connectBtn} onClick={() => setConnecting(true)}>+ Connect ports…</button>
        </div>
      </div>

      {connecting && <ConnectPortsDialog rackId={rack.id} onClose={() => setConnecting(false)} />}
    </div>
  );
}
