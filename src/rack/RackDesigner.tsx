import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { createInterface, defaultDeviceName } from '@/model/schema';
import { rasterize, downloadBlob } from '@/io/export/raster';
import { buildPdfBlob } from '@/io/export/pdf';
import { RackCanvas, type RejectInfo } from './RackCanvas';
import { RackRow } from './RackRow';
import { ConnectPortsDialog } from './ConnectPortsDialog';
import {
  buildRackSvg,
  buildRackRowFacesSvg,
  buildLabelSheetSvg,
  buildConnectionsTableSvg,
  composeExport,
  cableScheduleCsv,
  cableScheduleRows,
  type ExportMode,
} from './buildRackSvg';
import { analyzeCabling } from './rackHealth';
import { rackBudget, fleetBudget } from './rackBudget';
import { powerFeedAnalysis } from './rackPower';
import { slotOf, canFit, nearestFreeU, isFullDepth, orderRacks, type FitResult } from './rackModel';
import { RACK_DEVICE_PRESETS, RACK_PRESET_GROUPS, type RackDevicePreset } from './rackDevicePresets';
import { RACK_PRESETS, rackFieldsFromPreset, DEFAULT_RACK_PRESET } from './rackTypes';
import { RackTemplatePicker } from './RackTemplatePicker';
import type { RackTemplate } from './rackTemplates';
import { COLOR_BY_MODES, colorByLegend, type ColorByMode } from './rackColorBy';
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
  const rev = useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const s = useProjectStore.getState;

  // Racks in left-to-right row order (the optional `order` field, else insertion order).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const racks = useMemo(() => orderRacks(s().racksAll()), [rev]);
  const [rackId, setRackId] = useState<string>(racks[0]?.id ?? '');
  const rack = racks.find((r) => r.id === rackId) ?? racks[0];
  // The side-by-side canvas (all racks, both faces) is the DEFAULT; clicking a rack drills
  // into the focused single-rack editor for port-level work.
  const [view, setView] = useState<'focus' | 'row'>('row');
  const [showRear, setShowRear] = useState(true);
  const [armed, setArmed] = useState<RackDevicePreset | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [newType, setNewType] = useState<string>(DEFAULT_RACK_PRESET.id);
  const [reject, setReject] = useState<RejectInfo | null>(null);
  const [side, setSideState] = useState<'front' | 'rear'>('front');
  const [bay, setBay] = useState<'full' | 'left' | 'right'>('full');
  const [selCable, setSelCable] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [colorBy, setColorBy] = useState<ColorByMode>('gear');
  const [search, setSearch] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [exportMode, setExportMode] = useState<ExportMode>('diagram');

  // Snapshot the store collections ONCE per revision. devicesAll()/rackCablesAll() each
  // return a fresh array, so memoizing them on `rev` is what makes every downstream memo
  // (budget, searchHits, cabling, inRack) actually cache instead of recomputing per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const devices = useMemo(() => s().devicesAll(), [rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cables = useMemo(() => s().rackCablesAll(), [rev]);
  const selectedId = [...selection][0] ?? null;
  const selected = selectedId ? devices.find((d) => d.id === selectedId) : undefined;
  const inRack = useMemo(() => devices.filter((d) => d.rackId === rack?.id), [devices, rack?.id]);
  const budget = useMemo(() => (rack ? rackBudget(rack, devices) : null), [rack, devices]);
  const usedU = budget?.usedU ?? 0;
  // Cross-rack device search → ids to highlight in the row view.
  const searchHits = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return new Set<string>();
    return new Set(devices.filter((d) => d.rackId != null && (d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q))).map((d) => d.id));
  }, [deviceSearch, devices]);
  // Physical-cabling health (warns, never blocks).
  const cabling = useMemo(() => analyzeCabling(devices, cables), [devices, cables]);
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
        <div className={styles.stage} style={{ alignItems: 'flex-start' }}>
          <div className={styles.emptyState}>
            <div className={styles.hint} style={{ maxWidth: 'none' }}>
              No racks yet. Pick a rack type and start mounting gear.
              <div className={styles.cta}>
                <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {RACK_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>{' '}
                <button className={`${styles.btn} ${styles.primary}`} onClick={createRack}>+ New rack</button>
              </div>
            </div>
            <div className={styles.templatesWrap}>
              <RackTemplatePicker onApply={applyTemplate} />
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

  function applyTemplate(t: RackTemplate) {
    const ids = s().applyRackTemplate(t);
    if (ids[0]) setRackId(ids[0]);
    setView('row');
    setShowTemplates(false);
  }

  /** Shared by click-to-place AND drag-and-drop: validate, then create + mount, or reject. */
  function placePreset(preset: RackDevicePreset, u: number) {
    if (!rack) return;
    const span = preset.span;
    const mount = preset.mount ?? 'rack';
    const useBay = mount === 'rail' ? 'full' : bay; // rail items span the channel
    const depth = isFullDepth(preset.type) ? 'full' : 'shallow';
    const slot = {
      ru: Math.min(u, rack.ruHeight - span + 1),
      ruSpan: span,
      mount,
      side,
      bay: useBay,
      depth,
    } as const;
    const occ = devices.filter((d) => d.rackId === rack.id);
    // Pre-check BEFORE creating anything — never leave an orphan device on rejection.
    const fit = canFit(rack, occ, slot);
    if (!fit.ok) {
      setReject({
        u: slot.ru,
        span,
        reason: rejectReason(fit),
        pulseU: nearestFreeU(rack, occ, span, slot.ru, side, useBay, depth),
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
    s().updateDevice(
      id,
      { name: base, interfaces: [], watts: undefined, weightKg: undefined },
      { name, interfaces: ifaces, watts: preset.watts || undefined, weightKg: preset.weightKg || undefined },
    );
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

  /** Move a rack one slot left/right in the row by swapping `order` with its neighbor. */
  function reorderRack(id: string, dir: -1 | 1) {
    const i = racks.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= racks.length) return;
    const a = racks[i]!;
    const b = racks[j]!;
    const ao = a.order ?? i;
    const bo = b.order ?? j;
    s().updateRack(a.id, { order: a.order }, { order: bo });
    s().updateRack(b.id, { order: b.order }, { order: ao });
  }

  /** Drop a device into another rack at the nearest free U (keeps its span/side/bay).
      Surfaces a rejection (and does NOT move) when the target rack has no room — never a
      silent no-op. On success, follow the device to its new rack so the move is visible. */
  function moveDeviceToRack(deviceId: string, targetRackId: string) {
    const d = devices.find((x) => x.id === deviceId);
    const target = racks.find((r) => r.id === targetRackId);
    if (!d || !target || d.rackId === targetRackId) return;
    const sl = slotOf(d);
    const occ = devices.filter((x) => x.rackId === targetRackId);
    const wanted = Math.max(1, Math.min(sl.ru, target.ruHeight - sl.ruSpan + 1));
    const u = nearestFreeU(target, occ, sl.ruSpan, wanted, sl.side, sl.bay, sl.depth);
    const showReject = (reason: string) => {
      setReject({ u: wanted, span: sl.ruSpan, reason, pulseU: null });
      window.setTimeout(() => setReject(null), 2400);
    };
    if (u == null) { showReject(`No room in ${target.name}`); return; }
    const fit = s().placeInRack(deviceId, targetRackId, { ...sl, ru: u });
    if (!fit.ok) { showReject(rejectReason(fit)); return; }
    setRackId(targetRackId);
    s().select([deviceId]);
  }

  function cloneCurrentRack() {
    if (!rack) return;
    const id = s().cloneRack(rack.id);
    if (id) setRackId(id);
  }

  /** Build the export SVG honoring the row/focus view and the chosen export mode. */
  function exportSvg(background: string): string {
    const rackSvg =
      view === 'row'
        ? buildRackRowFacesSvg(racks, devices, cables, { showRear, background })
        : buildRackSvg(rack!, devices, cables, { background, side });
    if (exportMode === 'diagram') return rackSvg;
    const tableSvg = buildConnectionsTableSvg(cableScheduleRows(devices, cables), { background, title: 'Connections' });
    return composeExport(rackSvg, tableSvg, exportMode, background);
  }
  const exportName = () => (view === 'row' ? 'all-racks' : rack?.name ?? 'rack');

  function exportPng() {
    if (!rack) return;
    rasterize(exportSvg('#0c1015'), { scale: 2, mimeType: 'image/png', background: null })
      .then(({ blob }) => downloadBlob(blob, `${exportName()}.png`))
      .catch(() => undefined);
  }
  function exportPdf() {
    if (!rack) return;
    buildPdfBlob(exportSvg('#ffffff'), { pageSize: 'a4', orientation: 'portrait', scale: 2 })
      .then((blob) => downloadBlob(blob, `${exportName()}.pdf`))
      .catch(() => undefined);
  }
  function exportCsv() {
    if (!rack) return;
    const csv = cableScheduleCsv(devices, cables);
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `${exportName()}-cables.csv`);
  }
  function exportLabels() {
    rasterize(buildLabelSheetSvg(racks, devices, { background: '#ffffff' }), { scale: 2, mimeType: 'image/png', background: null })
      .then(({ blob }) => downloadBlob(blob, `${exportName()}-labels.png`))
      .catch(() => undefined);
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Rack designer</span>
        {view === 'focus' ? (
          <button className={styles.btn} title="Back to the all-racks canvas" onClick={() => { setView('row'); s().select([]); }}>← All racks</button>
        ) : (
          <span className={styles.stat}>{racks.length} rack{racks.length === 1 ? '' : 's'} · click one to edit</span>
        )}
        <button className={styles.btn} onClick={createRack}>+ Rack</button>
        <button className={`${styles.btn} ${showTemplates ? styles.primary : ''}`} title="Insert a pre-made rack template" onClick={() => setShowTemplates((v) => !v)}>Templates</button>
        <button className={styles.btn} title="Duplicate the focused rack with its gear + cabling" onClick={cloneCurrentRack}>Clone</button>
        {view === 'row' ? (
          <>
            <button className={`${styles.btn} ${!showRear ? styles.primary : ''}`} title="Show or hide the rear face of every rack" onClick={() => setShowRear((v) => !v)}>
              {showRear ? 'Hide rear' : 'Show rear'}
            </button>
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorByMode)} title="Tint devices by an attribute to scan the fleet">
              {COLOR_BY_MODES.map((m) => <option key={m.value} value={m.value}>Color: {m.label}</option>)}
            </select>
          </>
        ) : (
          <>
            <select value={rack.id} onChange={(e) => setRackId(e.target.value)} title="Jump to another rack">
              {racks.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.ruHeight}U</option>)}
            </select>
            <div className={styles.seg} title="Mounting face — devices on opposite faces don't collide.">
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
          </>
        )}
        <div className={styles.spacer} />
        <span className={styles.stat} title="Used / total U (and power/weight if capped)">
          {usedU} / {rack.ruHeight}U{budget && budget.maxWatts != null ? ` · ${budget.watts}/${budget.maxWatts}W` : ''}
          {budget && (budget.overWatts || budget.overWeight) ? ' ⚠' : ''}
        </span>
        <select value={exportMode} onChange={(e) => setExportMode(e.target.value as ExportMode)} title="What to include in PNG/PDF export">
          <option value="diagram">Diagram</option>
          <option value="diagram+table">Diagram + table</option>
          <option value="table-only">Table only</option>
        </select>
        <button className={styles.btn} onClick={exportCsv}>Cable CSV</button>
        <button className={styles.btn} title="Printable label strips for every device" onClick={exportLabels}>Labels</button>
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
      <div className={`${styles.stage} ${armed && view === 'focus' ? styles.placing : ''}`} style={view === 'row' ? { flexDirection: 'column', alignItems: 'stretch' } : undefined}>
        {showTemplates && (
          <div className={styles.templateOverlay} onClick={() => setShowTemplates(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <RackTemplatePicker onApply={applyTemplate} onClose={() => setShowTemplates(false)} />
            </div>
          </div>
        )}
        {view === 'row' ? (
          <>
            <input
              className={styles.libSearch}
              style={{ maxWidth: 280, alignSelf: 'center', marginBottom: 14 }}
              placeholder="Find a device across all racks…"
              value={deviceSearch}
              onChange={(e) => setDeviceSearch(e.target.value)}
              aria-label="Search devices across racks"
            />
            {(() => {
              const f = fleetBudget(racks, devices);
              const pct = f.totalU > 0 ? Math.round((f.usedU / f.totalU) * 100) : 0;
              return (
                <div className={styles.capacityStrip} role="status" aria-label="Fleet capacity">
                  <span><b>{f.rackCount}</b> rack{f.rackCount === 1 ? '' : 's'}</span>
                  <span><b>{f.usedU}</b>/{f.totalU}U used · <b>{f.freeU}</b> free ({pct}%)</span>
                  <span><b>{(f.watts / 1000).toFixed(2)}</b> kW{f.maxWatts > 0 ? ` / ${(f.maxWatts / 1000).toFixed(2)} kW` : ''}</span>
                  <span><b>{f.weightKg.toFixed(0)}</b> kg</span>
                  {(() => {
                    const pf = powerFeedAnalysis(devices);
                    if (pf.normalA + pf.normalB <= 0) return null;
                    return (
                      <>
                        <span title="Per-feed power load (dual-corded gear splits A/B)">⚡ A <b>{(pf.normalA / 1000).toFixed(2)}</b> · B <b>{(pf.normalB / 1000).toFixed(2)}</b> kW</span>
                        {pf.singleCorded > 0 && (
                          <span className={styles.capOver} title="Single-corded devices have no A/B power redundancy">
                            ⚠ {pf.singleCorded} single-corded
                          </span>
                        )}
                      </>
                    );
                  })()}
                  {f.anyOver && <span className={styles.capOver}>⚠ over capacity</span>}
                </div>
              );
            })()}
            {colorBy !== 'gear' && (() => {
              const legend = colorByLegend(devices, colorBy);
              if (legend.length === 0) return null;
              return (
                <div className={styles.capacityStrip} style={{ marginTop: -6 }} role="group" aria-label="Color legend">
                  {legend.map((e) => (
                    <span key={e.value} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: e.color, display: 'inline-block' }} />
                      {e.value}
                    </span>
                  ))}
                </div>
              );
            })()}
            <RackRow
              racks={racks}
              devices={devices}
              cables={cables}
              selectedId={selectedId}
              searchHits={searchHits}
              showRear={showRear}
              colorBy={colorBy}
              onFocusRack={(id) => { setRackId(id); setView('focus'); }}
              onSelect={(id) => s().select(id ? [id] : [])}
              onReorder={reorderRack}
            />
          </>
        ) : (
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
        )}
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
              {racks.length > 1 && (
                <div className={styles.kv} style={{ marginTop: 6 }}>
                  <span>Move to rack</span>
                  <select
                    value={selected.rackId ?? ''}
                    onChange={(e) => moveDeviceToRack(selected.id, e.target.value)}
                    aria-label="Move device to another rack"
                  >
                    {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              )}
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
        {cabling.issues.length > 0 && (
          <div className={styles.sec}>
            <h3>Cabling health · {cabling.issues.length}</h3>
            {cabling.issues.slice(0, 8).map((iss) => (
              <div
                key={iss.id}
                className={styles.healthIssue}
                title="Click to select the cable/device"
                onClick={() => { const id = iss.objectIds.find((o) => cables.some((c) => c.id === o)); if (id) setSelCable(id); else if (iss.objectIds[0]) s().select([iss.objectIds[0]]); }}
              >
                <span className={styles.healthDot} />
                {iss.message}
              </div>
            ))}
            {cabling.issues.length > 8 && (
              <div style={{ fontSize: 11, color: 'var(--chrome-fg-muted)', marginTop: 4 }}>+{cabling.issues.length - 8} more…</div>
            )}
          </div>
        )}
        <div className={styles.sec} style={{ flex: 1 }}>
          <h3>
            Cable schedule · {cables.length}
            {cables.some((c) => c.lengthFt == null) && (
              <button
                className={styles.btn}
                style={{ float: 'right', fontSize: 11 }}
                title="Estimate length (ft) from rack geometry for every cable without one"
                onClick={() => s().autoLengthRackCables()}
              >
                Auto-length
              </button>
            )}
          </h3>
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
                {c.lengthFt != null && <span className={styles.lbl}>{c.lengthFt}ft</span>}
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
