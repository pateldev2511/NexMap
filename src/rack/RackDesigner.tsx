import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { createInterface, defaultDeviceName } from '@/model/schema';
import { rasterize, downloadBlob } from '@/io/export/raster';
import { buildPdfBlob } from '@/io/export/pdf';
import { RackCanvas, type RejectInfo, type RackGestureApi } from './RackCanvas';
import { RackRow } from './RackRow';
import { keyboardRouter } from '@/input/router';
import { announce } from '@/ui/announce';
import { RACK_WHEEL_HINT_EVENT, RACK_WHEEL_HINT_TEXT } from './wheelHint';

/** Rejected-drop flash duration — keep in sync with the CSS pulse. */
const REJECT_FLASH_MS = 2400;
/** One-time wheel-migration toast auto-dismiss. */
const WHEEL_HINT_MS = 8000;
import { ConnectPortsDialog, CABLE_COLORS, type CableSeedEnd } from './ConnectPortsDialog';
import { buildLabelSheetSvg, cableScheduleCsv, type ExportMode } from './buildRackSvg';
import { buildHandoffSvg, cableCountLabel, exportFailureMessage, handoffFileName, handoffScope, type ExportScopeKind } from './rackExport';
import { analyzeCabling } from './rackHealth';
import { rackBudget, fleetBudget } from './rackBudget';
import { cordsIntoPdu, isPdu, isRackUps, nextPduFeed, powerFeedAnalysis } from './rackPower';
import { analyzeRackPower, feedFailure, feedFailureSummary, kw, powerCordCsv, powerStripCsv, unitFate } from './powerCords';
import { slotOf, canFit, nearestFreeU, nearestFreeRail, railChannel, isFullDepth, isFullHeightRail, orderRacks, type FitResult } from './rackModel';
import { RACK_DEVICE_PRESETS, RACK_PRESET_GROUPS, presetSpan, type RackDevicePreset } from './rackDevicePresets';
import { cableLanes, managerSpanLabel, routeLabel } from './cableLanes';
import { isCableManager } from './panelKind';
import { planPatches } from './patchPlan';
import { RACK_PRESETS, rackFieldsFromPreset, DEFAULT_RACK_PRESET } from './rackTypes';
import { RackTemplatePicker } from './RackTemplatePicker';
import { catalogById, catalogForType, catalogPatch, catalogSpecLabel } from './rackCatalog';
import type { RackTemplate } from './rackTemplates';
import { PartsListPanel } from './PartsListPanel';
import { COLOR_BY_MODES, colorByLegend, failedFeed, type ColorByMode } from './rackColorBy';
import { rackInsights, type RackInsight } from './rackInsights';
import { rackHealthScore } from './rackHealthScore';
import { bomCsv } from './rackBom';
import { deviceMatchesQuery } from './rackSearch';
import { hasBulkChanges } from './rackBulk';
import { validatePhoto, isRasterPhotoDataUri, PHOTO_ACCEPT } from './rackPhotoUpload';
import { deviceFaceParts, RACK_ART_DEFS } from './rackDeviceArt';
import { estimateCableLengthFt } from './cableLength';
import type { Device, TextObject } from '@/model/types';
import styles from './RackDesigner.module.css';

/** Human-readable reason for a rejected drop. */
function rejectReason(fit: FitResult, mount: 'rack' | 'rail' = 'rack'): string {
  if (fit.ok) return '';
  switch (fit.reason) {
    case 'occupied':
      return mount === 'rail' ? 'That rail channel is taken here' : 'That U is occupied';
    case 'bay-conflict':
      return 'That half-bay is taken';
    case 'out-of-bounds':
      return "Won't fit there";
    default:
      return 'Invalid slot';
  }
}

const PRESET_THUMB_CATALOG: Record<string, string> = {
  'sw-48': 'arista-7050sx3-48',
  'sw-24': 'cisco-c9300-24t',
  'sw-16': 'ubnt-usw-pro-48',
  'sw-8': 'netgear-gs724t',
  'sw-4': 'netgear-gs724t',
  'sw-core': 'cisco-n9336c',
  router: 'cisco-isr4331',
  firewall: 'forti-100f',
  lb: 'f5-i2800',
  wlc: 'cisco-c9800-40',
  console: 'juniper-ex4300-48t',
  'server-2u': 'dell-r750',
  'server-1u': 'dell-r650',
  blade: 'hpe-dl380-g11',
  storage: 'dell-me5024',
  ups: 'apc-srt2200',
  psu: 'apc-srt2200',
  'patch-24': 'panduit-24',
  'patch-48': 'panduit-48',
  fiber: 'panduit-24',
};

function GearThumb({ preset, device }: { preset?: RackDevicePreset; device?: Device }) {
  const panelH = preset ? Math.max(22, Math.min(34, preset.span * 13)) : 28;
  const panel = { x: 5, y: 5, w: 112, h: panelH };
  const thumbModel = preset ? catalogById(PRESET_THUMB_CATALOG[preset.key] ?? '') : undefined;
  const source: Device = device ?? {
    id: `thumb-${preset?.key ?? 'device'}`,
    kind: 'device',
    type: preset?.type ?? 'generic',
    name: preset?.label ?? 'Device',
    ...(thumbModel ? { vendor: thumbModel.vendor, model: thumbModel.model } : {}),
    x: 0,
    y: 0,
    width: 56,
    height: 40,
    layerId: 'thumb',
    ...(preset?.accessory ? { rackAccessory: preset.accessory } : {}),
    interfaces: Array.from({ length: Math.min(preset?.ports ?? 0, 48) }, (_, i) => ({ id: `p${i}`, name: preset?.portName(i) ?? `p${i}` })),
  };
  return (
    <svg className={styles.gearThumb} viewBox={`0 0 122 ${panelH + 10}`} aria-hidden="true">
      <g dangerouslySetInnerHTML={{ __html: RACK_ART_DEFS + deviceFaceParts(source, panel, 'front').join('') }} />
    </svg>
  );
}

const INSIGHT_GROUPS = ['Critical', 'Planning', 'Inventory', 'Cabling'] as const;
type InsightGroup = (typeof INSIGHT_GROUPS)[number];

function insightGroup(insight: RackInsight): InsightGroup {
  if (insight.severity === 'error') return 'Critical';
  if (insight.action === 'auto-length' || insight.action === 'review-health') return 'Cabling';
  if (insight.action === 'add-asset-tag' || /asset|owner|serial|warranty|inventory/i.test(`${insight.title} ${insight.detail}`)) {
    return 'Inventory';
  }
  return 'Planning';
}

function missingInventoryFields(d: Device): string[] {
  const missing: string[] = [];
  if (!d.assetTag) missing.push('asset tag');
  if (!d.owner) missing.push('owner');
  if (!d.serial) missing.push('serial');
  if (!d.vendor || !d.model) missing.push('model');
  if (!d.warrantyExpiry) missing.push('warranty');
  return missing;
}

function inventoryCompleteness(devices: Device[]) {
  const mounted = devices.filter((d) => d.rackId != null);
  const total = mounted.length * 5;
  if (total === 0) return { pct: 100, missing: 0, mounted: 0 };
  const missing = mounted.reduce((sum, d) => sum + missingInventoryFields(d).length, 0);
  return { pct: Math.round(((total - missing) / total) * 100), missing, mounted: mounted.length };
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
  const [connectingFrom, setConnectingFrom] = useState<CableSeedEnd | undefined>();
  const [newType, setNewType] = useState<string>(DEFAULT_RACK_PRESET.id);
  const [reject, setReject] = useState<RejectInfo | null>(null);
  const [side, setSideState] = useState<'front' | 'rear'>('front');
  const [bayPick, setBay] = useState<'full' | 'left' | 'right'>('full');
  const [selCable, setSelCable] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showParts, setShowParts] = useState(false);
  const [colorBy, setColorBy] = useState<ColorByMode>('gear');
  const [search, setSearch] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [exportMode, setExportMode] = useState<ExportMode>('diagram');
  const [bulkPatch, setBulkPatch] = useState<Partial<Device>>({});
  const [assetPrefix, setAssetPrefix] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScopeKind>('fleet');
  const [exportNote, setExportNote] = useState<{ kind: 'busy' | 'error'; text: string; retry?: () => void } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'placement' | 'hardware' | 'power' | 'cabling' | 'asset'>('placement');
  const [rowReject, setRowReject] = useState<string | null>(null);

  // Snapshot the store collections ONCE per revision. devicesAll()/rackCablesAll() each
  // return a fresh array, so memoizing them on `rev` is what makes every downstream memo
  // (budget, searchHits, cabling, inRack) actually cache instead of recomputing per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const devices = useMemo(() => s().devicesAll(), [rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cables = useMemo(() => s().rackCablesAll(), [rev]);
  const selectedId = [...selection][0] ?? null;
  const multi = selection.size >= 2;
  const selected = selectedId ? devices.find((d) => d.id === selectedId) : undefined;
  const inRack = useMemo(() => devices.filter((d) => d.rackId === rack?.id), [devices, rack?.id]);
  // Rack-scoped callouts for the focused rack (re-derived on any model change via rev).
  const rackCallouts = useMemo(
    () =>
      s()
        .objectsAll()
        .filter((o): o is TextObject => o.kind === 'text' && o.rackScope === rack?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rev, rack?.id],
  );
  const budget = useMemo(() => (rack ? rackBudget(rack, devices) : null), [rack, devices]);
  const usedU = budget?.usedU ?? 0;
  // "If feed A fails" color mode: what the failure takes down across every rack.
  const failure = useMemo(() => {
    const feed = failedFeed(colorBy);
    return feed ? feedFailure(racks, devices, feed) : null;
  }, [colorBy, racks, devices]);
  // Cross-rack device search → ids to highlight in the row view. Deep match: name, type,
  // vendor, model, role, owner, asset tag, serial, status, mgmt IP, VLAN (rackSearch.ts).
  const searchHits = useMemo(() => {
    const q = deviceSearch.trim();
    if (!q) return new Set<string>();
    return new Set(devices.filter((d) => d.rackId != null && deviceMatchesQuery(d, q)).map((d) => d.id));
  }, [deviceSearch, devices]);
  // Physical-cabling health (warns, never blocks).
  const cabling = useMemo(() => analyzeCabling(devices, cables), [devices, cables]);
  // Which cable manager dresses each cord, and how full each manager in this rack is.
  const lanes = useMemo(() => cableLanes(devices, cables), [devices, cables]);
  const rackFill = useMemo(() => lanes.fill.filter((f) => f.manager.rackId === rack?.id), [lanes, rack?.id]);
  // Which PDU outlet each cord in this rack plugs into (derived, never stored).
  // The focused rack's power, worked out once per change: cords, strip and UPS loads, and
  // what each feed's failure does. The Power tab reads these instead of recomputing per render.
  const rackPower = useMemo(() => (rack ? analyzeRackPower(rack, inRack) : null), [rack, inRack]);
  const powerCords = useMemo(() => rackPower?.cords ?? [], [rackPower]);
  const rackFailures = useMemo(
    () => (rack ? { A: feedFailure([rack], inRack, 'A'), B: feedFailure([rack], inRack, 'B') } : null),
    [rack, inRack],
  );
  // Logical links between racked gear that don't have a patch cable yet.
  const patchable = useMemo(
    () => planPatches(devices, s().linksAll(), cables, racks).items.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devices, cables, racks, rev],
  );
  const insights = useMemo(
    () => rackInsights({ racks, devices, cables, issues: cabling.issues, activeRackId: rack?.id, selectedDeviceId: selectedId }),
    [racks, devices, cables, cabling.issues, rack?.id, selectedId],
  );
  // Rack health score for the focused rack's header chip (0-100 + biggest risk).
  const health = useMemo(
    () => (rack ? rackHealthScore(rack, devices, cables, cabling.issues) : null),
    [rack, devices, cables, cabling.issues],
  );
  // What the Export handoff drawer's artifacts cover: the focused rack, or every rack.
  const handoff = useMemo(
    () => (rack ? handoffScope(exportScope, rack, racks, devices, cables) : null),
    [exportScope, rack, racks, devices, cables],
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
  const inventory = useMemo(() => inventoryCompleteness(devices), [devices]);
  const selectedMissing = useMemo(() => (selected ? missingInventoryFields(selected) : []), [selected]);
  const groupedInsights = useMemo(() => {
    const groups = new Map<InsightGroup, RackInsight[]>();
    for (const key of INSIGHT_GROUPS) groups.set(key, []);
    for (const insight of insights) groups.get(insightGroup(insight))!.push(insight);
    return groups;
  }, [insights]);
  const bestArmedU = useMemo(() => {
    if (!rack || !armed) return null;
    const span = presetSpan(armed, rack.ruHeight);
    const target = Math.min(21, rack.ruHeight);
    if ((armed.mount ?? 'rack') === 'rail') return nearestFreeRail(rack, inRack, span, target, side, bayPick)?.ru ?? null;
    const depth = isFullDepth(armed.type) ? 'full' : 'shallow';
    return nearestFreeU(rack, inRack, span, target, side, bayPick, depth);
  }, [armed, bayPick, inRack, rack, side]);

  /** Switch faces and drop any selection that belongs to the face we're leaving. */
  function setSide(next: 'front' | 'rear') {
    if (next === side) return;
    setSideState(next);
    setSelCable(null);
  }

  // Keyboard: canvas-shortcut stage of the shared router. Text targets never
  // reach this (the router steps aside, SELECT included), and Escape / Cmd+Z
  // during an in-flight rack gesture is consumed by the router's gesture-
  // cancel stage via the RackGestureApi the mounted canvas fills in.
  // Declared BEFORE the no-racks early return so hook order stays stable;
  // nudge()/deleteSelected() are hoisted function declarations.
  const rackGestureApi = useRef<RackGestureApi | null>(null);
  // Last placed preset — double-clicking an empty bay repeats it (M4c).
  const lastPresetRef = useRef<RackDevicePreset | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const handleRackKey = (e: KeyboardEvent): boolean => {
    if (e.code === 'Space') {
      e.preventDefault();
      setSpaceHeld(true);
      return true;
    }
    if (e.key === 'Escape') {
      // Innermost-only, one layer per press: armed cable-source port →
      // armed preset → highlighted cable → selection (behavior change 3).
      if (rackGestureApi.current?.clearArmed?.()) return true;
      if (armed) {
        setArmed(null);
        return true;
      }
      if (selCable) {
        setSelCable(null);
        return true;
      }
      if (s().selection.size > 0) {
        s().select([]);
        return true;
      }
      return false;
    }
    if (!selectedId) return false;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      nudge(1);
      return true;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(-1);
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
      return true;
    }
    return false;
  };
  const rackKeyRef = useRef(handleRackKey);
  rackKeyRef.current = handleRackKey;
  useEffect(
    () =>
      keyboardRouter.registerCanvas('rack', {
        cancelActiveGesture: () => rackGestureApi.current?.cancel(),
        hasActiveGesture: () => rackGestureApi.current?.active() ?? false,
        handleKey: (e) => rackKeyRef.current(e),
        handleKeyUp: (e) => {
          if (e.code === 'Space') setSpaceHeld(false);
        },
      }),
    [],
  );

  // One-time "scroll now pans" toast for returning users (behavior change 1).
  const [wheelHint, setWheelHint] = useState<string | null>(null);
  useEffect(() => {
    const onHint = () => {
      setWheelHint(RACK_WHEEL_HINT_TEXT);
      announce(RACK_WHEEL_HINT_TEXT); // live region: role=status mounted WITH text is often silent to SRs
      window.setTimeout(() => setWheelHint(null), WHEEL_HINT_MS);
    };
    window.addEventListener(RACK_WHEEL_HINT_EVENT, onHint);
    return () => window.removeEventListener(RACK_WHEEL_HINT_EVENT, onHint);
  }, []);

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
    // The bay / channel picker shows only while a preset is armed, so it applies only to
    // that preset; anything else (a library drag) fills the bay or picks a channel itself.
    const bay = armed?.key === preset.key ? bayPick : 'full';
    const span = presetSpan(preset, rack.ruHeight);
    const mount = preset.mount ?? 'rack';
    const depth = isFullDepth(preset.type) ? 'full' : 'shallow';
    const ru = Math.min(u, rack.ruHeight - span + 1);
    const occ = devices.filter((d) => d.rackId === rack.id);
    // A rail item goes in the channel the bay picks; with no pick, the right channel if
    // it has room at this U, else the left (so a second PDU becomes the B feed).
    const useBay = mount === 'rack' || bay !== 'full'
      ? bay
      : (['right', 'left'] as const).find((ch) => canFit(rack, occ, { ru, ruSpan: span, mount, side, bay: ch, depth }).ok) ?? 'right';
    const slot = { ru, ruSpan: span, mount, side, bay: useBay, depth } as const;
    lastPresetRef.current = preset;
    // Pre-check BEFORE creating anything — never leave an orphan device on rejection.
    const fit = canFit(rack, occ, slot);
    if (!fit.ok) {
      setReject({
        u: slot.ru,
        span,
        reason: rejectReason(fit, mount),
        pulseU: mount === 'rail'
          ? nearestFreeRail(rack, occ, span, slot.ru, side, bay)?.ru ?? null
          : nearestFreeU(rack, occ, span, slot.ru, side, useBay, depth),
      });
      announce(`Placement rejected: ${rejectReason(fit, mount)}`);
      window.setTimeout(() => setReject(null), REJECT_FLASH_MS);
      return;
    }
    setReject(null);
    // Create the device, give it a DISTINGUISHABLE auto-numbered name (so the cable
    // schedule reads "sw-01:Gi1/0/1", not five identical "Switch" rows), auto-populate
    // ports, all in one undoable edit, then place it.
    const base = preset.name ?? defaultDeviceName(preset.type);
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
      { name: base, interfaces: [], watts: undefined, weightKg: undefined, rackAccessory: undefined, powerFeed: undefined },
      {
        name,
        interfaces: ifaces,
        watts: preset.watts || undefined,
        weightKg: preset.weightKg || undefined,
        rackAccessory: preset.accessory,
        // A new PDU takes the feed the rack still lacks: the first is A, the second B.
        powerFeed: isPdu({ type: preset.type, mount }) ? nextPduFeed(rack.id, devices) : undefined,
      },
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
    const ru = Math.min(u, rack.ruHeight - slot.ruSpan + 1);
    const fit = s().placeInRack(id, rack.id, { ...slot, ru });
    if (!fit.ok) {
      // Behavior change #5: a rejected drag-move (or blocked nudge) flashes
      // the slot + reason and pulses the nearest U that WOULD fit — never a
      // silent no-op. (This path used to discard the FitResult.)
      const others = devices.filter((x) => x.rackId === rack.id && x.id !== id);
      setReject({
        u: ru,
        span: slot.ruSpan,
        reason: rejectReason(fit, slot.mount),
        pulseU: nearestFreeU(rack, others, slot.ruSpan, ru, slot.side, slot.bay, slot.depth, undefined, slot.mount, slot.depthMm),
      });
      announce(`Move rejected: ${rejectReason(fit, slot.mount)}`);
      window.setTimeout(() => setReject(null), REJECT_FLASH_MS);
    }
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

  function updateSelected<K extends keyof Device>(key: K, value: Device[K]) {
    if (!selected) return;
    s().updateDevice(
      selected.id,
      { [key]: selected[key] } as Partial<Device>,
      { [key]: value } as Partial<Device>,
    );
  }

  function commitSelectedEdit() {
    s().endEdit();
  }

  function applyCatalogModel(modelId: string) {
    if (!selected) return;
    const model = catalogById(modelId);
    if (!model) return;
    const { before, after } = catalogPatch(selected, model);
    s().updateDevice(selected.id, before, after);
    s().endEdit();
  }

  function deviceCableRows(deviceId: string) {
    return cables.filter((c) => c.aEnd.deviceId === deviceId || c.bEnd.deviceId === deviceId);
  }

  function focusDevice(deviceId: string) {
    const d = devices.find((x) => x.id === deviceId);
    if (!d) return;
    if (d.rackId) setRackId(d.rackId);
    setSideState(slotOf(d).side);
    s().select([deviceId]);
  }

  /** Canvas device click: plain = focus one; shift/cmd/ctrl = toggle into a multi-selection. */
  function selectDevice(id: string | null, additive?: boolean) {
    if (!id) {
      s().select([]);
      return;
    }
    if (additive) {
      const sel = new Set(selection);
      if (sel.has(id)) sel.delete(id);
      else sel.add(id);
      s().select([...sel]);
      return;
    }
    focusDevice(id);
  }

  function applyBulk() {
    const n = s().bulkUpdateDevices([...selection], bulkPatch);
    if (n > 0) setBulkPatch({});
    return n;
  }

  function assignAssetTags() {
    const n = s().bulkPrefixAssetTags([...selection], assetPrefix);
    if (n > 0) setAssetPrefix('');
    return n;
  }

  function openConnectFromSelected() {
    if (selected) setConnectingFrom({ deviceId: selected.id });
    else setConnectingFrom(undefined);
    setInspectorTab('cabling');
    setConnecting(true);
  }

  function focusFirstMissingAsset() {
    const target = devices.find((d) => d.rackId != null && !d.assetTag);
    if (target) focusDevice(target.id);
    setInspectorTab('asset');
  }

  /** Validate + read a chosen photo file into a data-URI and store it on the selected device. */
  function onPhotoFile(file: File | undefined | null) {
    if (!file || !selected) return;
    const v = validatePhoto(file.type, file.size);
    if (!v.ok) {
      setPhotoError(v.error ?? 'Invalid image.');
      return;
    }
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const uri = typeof reader.result === 'string' ? reader.result : '';
      if (isRasterPhotoDataUri(uri)) s().setDevicePhoto(selected.id, uri);
      else setPhotoError('Could not read that image.');
    };
    reader.onerror = () => setPhotoError('Could not read that image.');
    reader.readAsDataURL(file);
  }

  function handleInsight(insight: RackInsight) {
    if (insight.action === 'auto-length') {
      s().autoLengthRackCables();
      return;
    }
    if (insight.action === 'fill-depths') {
      s().fillDepthsFromCatalog();
      return;
    }
    if (insight.action === 'add-asset-tag') {
      if (insight.deviceId) focusDevice(insight.deviceId);
      setInspectorTab('asset');
      return;
    }
    if (insight.action === 'balance-power') {
      // The imbalance insight is actionable: actually rebalance A/B. The single-corded
      // insight is a hardware-redundancy problem a feed flip can't fix — just navigate.
      if (insight.id === 'power-imbalance') {
        const moved = s().balancePower();
        if (moved === 0 && selectedId) setInspectorTab('power');
      } else {
        if (selectedId) setInspectorTab('power');
      }
      return;
    }
    if (insight.action === 'add-pdu' && insight.rackId) {
      const feed = insight.id.endsWith('-B') ? 'B' : 'A';
      const id = s().addPdu(insight.rackId, feed);
      if (id) {
        setRackId(insight.rackId);
        const d = s().devicesAll().find((x) => x.id === id);
        if (d) setSideState(slotOf(d).side);
      }
      return;
    }
    if (insight.action === 'review-pdu' && insight.rackId && insight.deviceId) {
      const d = devices.find((x) => x.id === insight.deviceId);
      setRackId(insight.rackId);
      if (d) setSideState(slotOf(d).side);
      focusDevice(insight.deviceId);
      setInspectorTab('power');
      return;
    }
    if (insight.action === 'go-to-u' && insight.deviceId && insight.rackId && insight.targetU != null) {
      const d = devices.find((x) => x.id === insight.deviceId);
      const target = racks.find((r) => r.id === insight.rackId);
      if (!d || !target) return;
      const sl = slotOf(d);
      s().placeInRack(insight.deviceId, insight.rackId, { ...sl, ru: insight.targetU });
      setView('focus');
      focusDevice(insight.deviceId);
      return;
    }
    if (insight.action === 'review-health') {
      const cableId = insight.objectIds?.find((id) => cables.some((c) => c.id === id));
      const deviceId = insight.objectIds?.find((id) => devices.some((d) => d.id === id));
      if (cableId) setSelCable(cableId);
      if (deviceId) focusDevice(deviceId);
      setInspectorTab('cabling');
      return;
    }
    if (insight.rackId) {
      setRackId(insight.rackId);
      setView('row');
    }
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
  function moveDeviceToRack(deviceId: string, targetRackId: string, follow = true, preferredU?: number): boolean {
    const d = devices.find((x) => x.id === deviceId);
    const target = racks.find((r) => r.id === targetRackId);
    if (!d || !target || d.rackId === targetRackId) return false;
    const from = racks.find((r) => r.id === d.rackId);
    // A full-height rail item takes the target rack's height, not its old one.
    const sl = { ...slotOf(d), ...(from && isFullHeightRail(d, from) ? { ruSpan: target.ruHeight } : {}) };
    const occ = devices.filter((x) => x.rackId === targetRackId);
    // A pointer drag (row view) says WHERE the user pointed; the panel's
    // "Move to rack" control has no cursor, so it keeps the device's old U.
    const wanted = Math.max(1, Math.min(preferredU ?? sl.ru, target.ruHeight - sl.ruSpan + 1));
    // A rail item takes whichever channel of the target rack has room nearest.
    const railSpot = sl.mount === 'rail' ? nearestFreeRail(target, occ, sl.ruSpan, wanted, sl.side) : null;
    const u = sl.mount === 'rail'
      ? railSpot?.ru ?? null
      : nearestFreeU(target, occ, sl.ruSpan, wanted, sl.side, sl.bay, sl.depth, undefined, 'rack', sl.depthMm);
    const showReject = (reason: string) => {
      announce(`Move rejected: ${reason}`);
      setReject({ u: wanted, span: sl.ruSpan, reason, pulseU: null });
      setRowReject(reason);
      window.setTimeout(() => setReject(null), REJECT_FLASH_MS);
      window.setTimeout(() => setRowReject(null), REJECT_FLASH_MS);
    };
    if (u == null) { showReject(`No room in ${target.name}`); return false; }
    const fit = s().placeInRack(deviceId, targetRackId, { ...sl, ru: u, ...(railSpot ? { bay: railSpot.bay } : {}) });
    if (!fit.ok) { showReject(rejectReason(fit, sl.mount)); return false; }
    if (follow) setRackId(targetRackId);
    setSideState(sl.side);
    s().select([deviceId]);
    return true;
  }

  function cloneCurrentRack() {
    if (!rack) return;
    const id = s().cloneRack(rack.id);
    if (id) setRackId(id);
  }

  /** Open the drawer scoped to what's on screen: the focused rack, or the whole row. */
  function openExport() {
    setExportScope(view === 'row' ? 'fleet' : 'rack');
    setExportNote(null);
    setExportOpen(true);
  }

  /**
   * Render + download one artifact. A failure says what didn't export and why, keeps the
   * drawer open, and offers Retry — never a click that silently does nothing.
   */
  async function runExport(what: string, file: string, make: () => Blob | Promise<Blob>) {
    const retry = () => void runExport(what, file, make);
    setExportNote({ kind: 'busy', text: `Exporting ${what}…` });
    try {
      downloadBlob(await make(), file);
      setExportNote(null);
    } catch (err) {
      const text = exportFailureMessage(what, err, handoff!);
      setExportNote({ kind: 'error', text, retry });
      announce(text);
    }
  }

  /** The export SVG for the drawer's scope, honoring the focus view's face and the export mode. */
  function exportSvg(background: string, mode: ExportMode): string {
    // Every rack-scoped callout across the project; each renderer keeps only its own.
    const allCallouts = s()
      .objectsAll()
      .filter((o): o is TextObject => o.kind === 'text' && !!o.rackScope);
    return buildHandoffSvg(handoff!, devices, cables, {
      mode,
      background,
      ...(view === 'focus' && handoff!.kind === 'rack' ? { singleFace: { side } } : {}),
      showRear,
      callouts: allCallouts,
    });
  }

  const csvBlob = (csv: string) => new Blob([csv], { type: 'text/csv' });
  const artifactName = (mode: ExportMode) => (mode === 'diagram' ? 'elevation' : 'install packet');
  function exportPng(mode: ExportMode = exportMode) {
    if (!handoff) return;
    void runExport(`the ${handoff.label} ${artifactName(mode)} PNG`, handoffFileName(handoff, mode === 'diagram' ? 'elevation' : 'install-packet', 'png'), () =>
      rasterize(exportSvg('#0c1015', mode), { scale: 2, mimeType: 'image/png', background: null }).then((r) => r.blob),
    );
  }
  function exportPdf(mode: ExportMode = exportMode) {
    if (!handoff) return;
    void runExport(`the ${handoff.label} ${artifactName(mode)} PDF`, handoffFileName(handoff, mode === 'diagram' ? 'elevation' : 'install-packet', 'pdf'), () =>
      buildPdfBlob(exportSvg('#ffffff', mode), { pageSize: 'a4', orientation: 'portrait', scale: 2 }),
    );
  }
  function exportCsv() {
    if (!handoff) return;
    void runExport(`the ${handoff.label} cable schedule`, handoffFileName(handoff, 'cables', 'csv'), () =>
      csvBlob(cableScheduleCsv(devices, handoff.cables, handoff.schedule)),
    );
  }
  function exportPowerCords() {
    if (!handoff) return;
    void runExport(`the ${handoff.label} power-cord list`, handoffFileName(handoff, 'power-cords', 'csv'), () =>
      csvBlob(powerCordCsv(handoff.racks, devices)),
    );
  }
  function exportPowerStrips() {
    if (!handoff) return;
    void runExport(`the ${handoff.label} power-strip list`, handoffFileName(handoff, 'power-strips', 'csv'), () =>
      csvBlob(powerStripCsv(handoff.racks, devices)),
    );
  }
  function exportLabels() {
    if (!handoff) return;
    void runExport(`the ${handoff.label} label sheet`, handoffFileName(handoff, 'labels', 'png'), () =>
      rasterize(buildLabelSheetSvg(handoff.racks, devices, { background: '#ffffff', scope: handoff.label }), { scale: 2, mimeType: 'image/png', background: null })
        .then((r) => r.blob),
    );
  }
  function exportBom() {
    if (!handoff) return;
    void runExport(`the ${handoff.bom.label} BOM`, handoffFileName(handoff, 'bom', 'csv'), () => csvBlob(bomCsv(handoff.bom.devices)));
  }

  return (
    <div className={styles.root}>
      {wheelHint && (
        <div
          aria-hidden="true" /* announced via the shared live region instead */
          style={{
            position: 'fixed',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            background: 'var(--chrome-bg)',
            color: 'var(--chrome-fg)',
            border: '1px solid var(--chrome-border)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          }}
        >
          <span>{wheelHint}</span>
          <button
            onClick={() => setWheelHint(null)}
            aria-label="Dismiss"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--chrome-fg-muted)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className={styles.toolbar}>
        <div className={styles.brandBlock}>
          <span className={styles.title}>Rack designer</span>
          <span>{view === 'row' ? `${racks.length} rack${racks.length === 1 ? '' : 's'} · row view` : `${rack.name} · ${side}`}</span>
        </div>
        <div className={styles.breadcrumb} aria-label="Workspace path">
          <button onClick={() => setView('row')}>Row</button>
          <span>›</span>
          <button onClick={() => setView('focus')}>{rack.name}</button>
          <span>›</span>
          <button onClick={() => setSide(side === 'front' ? 'rear' : 'front')}>{side}</button>
          {(selected || selCable) && <span>›</span>}
          {selected && <button onClick={() => setInspectorTab('placement')}>{selected.name}</button>}
          {!selected && selCable && <button onClick={() => setInspectorTab('cabling')}>Cable</button>}
        </div>
        <div className={styles.commandGroup} aria-label="Rack commands">
          {view === 'focus' && (
            <button className={styles.btn} title="Back to the all-racks canvas" onClick={() => setView('row')}>All racks</button>
          )}
          <button className={styles.btn} onClick={createRack}>+ Rack</button>
          <button className={`${styles.btn} ${showTemplates ? styles.primary : ''}`} title="Insert a pre-made rack template" onClick={() => setShowTemplates((v) => !v)}>Templates</button>
          <button className={`${styles.btn} ${showParts ? styles.primary : ''}`} title="Paste a parts list and mount it into this rack" disabled={!rack} onClick={() => setShowParts((v) => !v)}>Parts list</button>
          <button className={styles.btn} title="Duplicate the focused rack with its gear + cabling" onClick={cloneCurrentRack}>Clone</button>
        </div>
        <div className={styles.commandGroup} aria-label="Plan and view controls">
          <div className={styles.seg} title="Workspace view">
            <button className={view === 'row' ? styles.on : ''} onClick={() => setView('row')}>Row view</button>
            <button className={view === 'focus' ? styles.on : ''} onClick={() => setView('focus')}>Single rack</button>
          </div>
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
              <button
                className={styles.btn}
                title="Add a name callout for every device on this face (skips ones already labeled)"
                onClick={() => s().annotateRack(rack.id, side)}
              >
                Annotate all
              </button>
              <button
                className={styles.btn}
                title="Add a document title block (project, rack, date) to the elevation"
                onClick={() => s().addTitleBlock(rack.id)}
              >
                Title block
              </button>
              <button
                className={styles.btn}
                title="Add a legend of the rack's cable colors"
                onClick={() => s().addLegend(rack.id)}
              >
                Legend
              </button>
              <button
                className={`${styles.btn} ${rack.hideFaceplateText ? styles.primary : ''}`}
                title="Hide device name labels on the faceplates so names read from the callout column"
                aria-pressed={!!rack.hideFaceplateText}
                onClick={() =>
                  s().updateRack(
                    rack.id,
                    { hideFaceplateText: rack.hideFaceplateText },
                    { hideFaceplateText: !rack.hideFaceplateText },
                  )
                }
              >
                {rack.hideFaceplateText ? 'Show names' : 'Hide names'}
              </button>
              {armed && (armed.mount ?? 'rack') === 'rack' && (
                <div className={styles.seg} title="Half-width bay: two devices share one U">
                  <button className={bayPick === 'full' ? styles.on : ''} onClick={() => setBay('full')}>Full</button>
                  <button className={bayPick === 'left' ? styles.on : ''} onClick={() => setBay('left')}>L</button>
                  <button className={bayPick === 'right' ? styles.on : ''} onClick={() => setBay('right')}>R</button>
                </div>
              )}
              {armed && armed.mount === 'rail' && (
                <div className={styles.seg} title="Rail channel: each face has a left and a right 0U channel">
                  <button className={bayPick === 'full' ? styles.on : ''} onClick={() => setBay('full')}>Auto</button>
                  <button className={bayPick === 'left' ? styles.on : ''} onClick={() => setBay('left')}>L</button>
                  <button className={bayPick === 'right' ? styles.on : ''} onClick={() => setBay('right')}>R</button>
                </div>
              )}
            </>
          )}
        </div>
        <span className={styles.commandMetric} title="Used / total U (and power/weight if capped)">
          <b>{usedU}</b>/{rack.ruHeight}U{budget && budget.maxWatts != null ? ` · ${budget.watts}/${budget.maxWatts}W` : ''}
          {budget && (budget.overWatts || budget.overWeight || budget.overDepth) ? ' ⚠' : ''}
        </span>
        <div className={styles.spacer} />
        <div className={styles.commandGroup} aria-label="Export controls">
          <button className={`${styles.btn} ${styles.primary}`} title="Open export presets" onClick={openExport}>Export handoff</button>
        </div>
      </div>

      {/* library */}
      <div className={styles.lib}>
        <div className={styles.panelTabs} aria-label="Rack library sections">
          <button className={styles.activeTab}>Library</button>
          <button onClick={() => setShowTemplates(true)}>Templates</button>
        </div>
        <input
          className={styles.libSearch}
          placeholder="Search gear…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search device library"
        />
        {/* (Dead decorative filter pills deleted — M3: chrome earns its
            pixels or goes. Search + groups already do the filtering.) */}
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
                <span className={styles.thumbWrap}><GearThumb preset={p} /></span>
                <span className={styles.chipText}>
                  <b>{p.label}</b>
                  <small>
                    {p.fullHeight ? 'Full height' : `${p.span}U`} · {p.ports} port{p.ports === 1 ? '' : 's'}
                    {p.watts > 0 ? ` · ${p.watts}W` : ''}
                    {p.weightKg > 0 ? ` · ${p.weightKg}kg` : ''}
                  </small>
                </span>
                <span className={styles.u}>{p.mount === 'rail' ? '0U' : `${p.span}U`}</span>
              </button>
            ))}
          </div>
          );
        })}
        <div className={styles.dragHint}>
          <b>Drag gear to rack</b>
          <span>Best-fit slots and conflicts are highlighted as you place equipment.</span>
        </div>
      </div>

      {/* canvas */}
      <div className={`${styles.stage} ${armed && view === 'focus' ? styles.placing : ''}`} style={view === 'row' ? { flexDirection: 'column', alignItems: 'stretch' } : undefined}>
        {showParts && rack && (
          <div className={styles.templateOverlay} onClick={() => setShowParts(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640 }}>
              <PartsListPanel rack={rack} onClose={() => setShowParts(false)} />
            </div>
          </div>
        )}
        {showTemplates && (
          <div className={styles.templateOverlay} onClick={() => setShowTemplates(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <RackTemplatePicker onApply={applyTemplate} onClose={() => setShowTemplates(false)} />
            </div>
          </div>
        )}
        <div className={styles.workflowRail} aria-label="Next actions">
          <button
            className={`${styles.workflowAction} ${armed ? styles.workflowHot : ''}`}
            onClick={() => {
              if (armed && bestArmedU != null) {
                setView('focus');
                placePreset(armed, bestArmedU);
                setArmed(null);
              } else {
                setView('focus');
                setInspectorTab('placement');
              }
            }}
          >
            <b>{armed && bestArmedU != null ? `Place at U${bestArmedU}` : 'Place gear'}</b>
            <span>{armed ? `${armed.label}${bestArmedU == null ? ' needs a free slot' : ''}` : `${budget?.freeU ?? 0}U free in ${rack.name}`}</span>
          </button>
          <button className={styles.workflowAction} onClick={openConnectFromSelected}>
            <b>Cable ports</b>
            <span>{selected ? `Start from ${selected.name}` : `${cables.length} cable${cables.length === 1 ? '' : 's'} in schedule`}</span>
          </button>
          <button
            className={`${styles.workflowAction} ${insights.some((i) => i.action === 'balance-power') ? styles.workflowWarn : ''}`}
            onClick={() => {
              const power = insights.find((i) => i.action === 'balance-power');
              if (power) handleInsight(power);
              else setInspectorTab('power');
            }}
          >
            <b>Fix power</b>
            <span>{insights.find((i) => i.action === 'balance-power')?.title ?? 'Review feed balance'}</span>
          </button>
          <button
            className={`${styles.workflowAction} ${inventory.missing > 0 ? styles.workflowWarn : ''}`}
            onClick={focusFirstMissingAsset}
          >
            <b>Add asset tags</b>
            <span>{inventory.pct}% complete · {inventory.missing} missing fields</span>
          </button>
          <button className={styles.workflowAction} onClick={openExport}>
            <b>Export handoff</b>
            <span>{view === 'row' ? 'Install packet for row' : `${rack.name} elevation`}</span>
          </button>
        </div>
        {view === 'row' ? (
          <>
            <div className={styles.workspaceHead}>
              <div>
                <h2>Rack row operations</h2>
                <p>Drag devices between cabinets, scan capacity, and drill into any rack for port-level work.</p>
              </div>
              <input
                className={styles.workspaceSearch}
                placeholder="Find by name, model, owner, asset tag, serial, VLAN…"
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
                aria-label="Search devices across racks by name, model, owner, asset tag, serial, or VLAN"
              />
            </div>
            {(() => {
              const f = fleetBudget(racks, devices);
              const pct = f.totalU > 0 ? Math.round((f.usedU / f.totalU) * 100) : 0;
              const pf = powerFeedAnalysis(devices);
              return (
                <div className={styles.capacityStrip} role="status" aria-label="Fleet capacity" data-demote="chrome">
                  <span><small>Racks</small><b>{f.rackCount}</b></span>
                  <span><small>Space</small><b>{f.freeU}U</b><em>{f.usedU}/{f.totalU}U · {pct}% used</em></span>
                  <span><small>Power</small><b>{(f.watts / 1000).toFixed(2)} kW</b><em>{f.maxWatts > 0 ? `/ ${(f.maxWatts / 1000).toFixed(2)} kW cap` : 'uncapped'}</em></span>
                  <span><small>Weight</small><b>{f.weightKg.toFixed(0)} kg</b></span>
                  {pf.normalA + pf.normalB > 0 && (
                    <span><small>A/B Feed</small><b>A {(pf.normalA / 1000).toFixed(2)} · B {(pf.normalB / 1000).toFixed(2)}</b></span>
                  )}
                  {pf.singleCorded > 0 && <span className={styles.capOver}><small>Risk</small><b>{pf.singleCorded} single-corded</b></span>}
                  {f.anyOver && <span className={styles.capOver}><small>Capacity</small><b>Over cap</b></span>}
                </div>
              );
            })()}
            {rowReject && <div className={styles.rowReject} role="status">{rowReject}</div>}
            {colorBy !== 'gear' && (() => {
              const legend = colorByLegend(devices, colorBy, failure);
              if (legend.length === 0 && !failure) return null;
              return (
                <>
                {failure && <div className={styles.failureVerdict} role="status">{feedFailureSummary(failure, devices)}</div>}
                {legend.length > 0 && <div className={styles.capacityStrip} style={{ marginTop: -6 }} role="group" aria-label="Color legend" data-demote="chrome">
                  {legend.map((e) => (
                    <span key={e.value} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: e.color, display: 'inline-block' }} />
                      {e.value}
                    </span>
                  ))}
                </div>}
                </>
              );
            })()}
            <RackRow
              racks={racks}
              devices={devices}
              cables={cables}
              activeRackId={rack.id}
              selectedId={selectedId}
              selectedIds={selection}
              searchHits={searchHits}
              showRear={showRear}
              colorBy={colorBy}
              failure={failure}
              onFocusRack={(id) => { setRackId(id); setView('focus'); }}
              onSelect={(id, additive) => {
                if (additive && id) { selectDevice(id, true); return; }
                if (id) focusDevice(id);
                else s().select([]);
              }}
              onReorder={reorderRack}
              onMoveDeviceToRack={(deviceId, targetRackId, wantedU) => moveDeviceToRack(deviceId, targetRackId, false, wantedU)}
              gestureApi={rackGestureApi}
            />
          </>
        ) : (
          <>
            <div className={styles.workspaceHead}>
              <div>
                <h2>{rack.name} · {rack.ruHeight}U · {side}</h2>
                <p>
                  {armed
                    ? `Place ${armed.label}: click a U slot or drag from the library.`
                    : 'Select gear to manage placement, hardware, power, cabling, and asset fields.'}
                </p>
              </div>
              <div className={styles.rackMiniStats}>
                {health && (
                  <span
                    className={`${styles.healthChip} ${styles[`health_${health.band}`]}`}
                    title={health.biggestRisk}
                    aria-live="polite"
                    aria-label={`Rack health ${health.score} of 100. ${health.biggestRisk}`}
                  >
                    <i className={styles.healthDot} aria-hidden="true" />
                    <b>{health.score}</b>/100
                  </span>
                )}
                <span><b>{usedU}</b> used</span>
                <span><b>{budget?.freeU ?? 0}</b> free</span>
                <span><b>{((budget?.watts ?? 0) / 1000).toFixed(2)}</b> kW</span>
              </div>
            </div>
            <div className={styles.focusCanvasWrap}>
              <RackCanvas
                callouts={rackCallouts}
                onQuickPlace={(u) => {
                  const p = armed ?? lastPresetRef.current;
                  if (p) placePreset(p, u);
                }}
                gestureApi={rackGestureApi}
                spaceHeld={spaceHeld}
                deviceActions={
                  selected
                    ? {
                        nudge,
                        unmount: () => {
                          s().select([selected.id]);
                          s().unmountFromRack(selected.id);
                        },
                        remove: deleteSelected,
                        racks: racks.map((r) => ({ id: r.id, name: r.name })),
                        moveToRack: (rid) => {
                          if (rid !== rack.id) moveDeviceToRack(selected.id, rid);
                        },
                      }
                    : undefined
                }
                cableActions={(() => {
                  const c = selCable ? cables.find((x) => x.id === selCable) : null;
                  if (!c) return undefined;
                  return {
                    setColor: (color: string) =>
                      s().updateRackCable(c.id, { color: c.color }, { color }),
                    setLabel: (label: string) =>
                      s().updateRackCable(c.id, { label: c.label }, { label: label || undefined }),
                    setLength: (lengthFt: number | null) =>
                      s().updateRackCable(
                        c.id,
                        { lengthFt: c.lengthFt },
                        { lengthFt: lengthFt ?? undefined },
                      ),
                    remove: () => {
                      s().disconnectRackCable(c.id);
                      setSelCable(null);
                    },
                    colors: [...CABLE_COLORS],
                  };
                })()}
                rack={rack}
                devices={devices}
                cables={cables}
                selectedId={selectedId}
                selectedIds={selection}
                selectedCableId={selCable}
                side={side}
                armed={armed != null}
                reject={reject}
                onPlaceAt={placeAt}
                onDropPreset={dropPreset}
                onSelect={selectDevice}
                onMarquee={(ids, additive) => s().select(ids, additive)}
                onConnectPorts={(a, b) => {
                  // Cycle the default palette so consecutive drag-cables aren't all one color.
                  const color = CABLE_COLORS[cables.length % CABLE_COLORS.length]!;
                  const aDevice = devices.find((d) => d.id === a.deviceId);
                  const bDevice = devices.find((d) => d.id === b.deviceId);
                  const lengthFt = aDevice && bDevice ? estimateCableLengthFt(aDevice, bDevice, racks) ?? undefined : undefined;
                  const id = s().connectRackCable(a, b, color, undefined, lengthFt);
                  if (id) setSelCable(id);
                }}
                onSelectCable={setSelCable}
                onMoveTo={moveTo}
              />
            </div>
          </>
        )}
      </div>

      {/* sidebar */}
      <div className={styles.side} data-demote="panel">
        <div className={styles.sec}>
          <h3>{multi ? `Bulk edit · ${selection.size} devices` : 'Selected device'}</h3>
          {multi ? (
            <div className={styles.inspectorPane}>
              <p className={styles.bulkHint}>
                Set a field on all {selection.size} selected devices at once. Leave a field
                blank to keep it unchanged. One undo reverts the whole batch.
              </p>
              <div className={styles.bulkQuick} aria-label="Bulk edit presets">
                <button className={styles.btn} onClick={() => setBulkPatch((p) => ({ ...p, status: 'active' }))}>Mark active</button>
                <button className={styles.btn} onClick={() => setBulkPatch((p) => ({ ...p, status: 'maintenance' }))}>Maintenance</button>
                <button className={styles.btn} onClick={() => setBulkPatch((p) => ({ ...p, powerFeed: 'AB' }))}>A+B feed</button>
              </div>
              <div className={styles.field}>
                <label>Status</label>
                <select
                  value={(bulkPatch.status as string) ?? ''}
                  onChange={(e) => setBulkPatch((p) => ({ ...p, status: (e.target.value || undefined) as Device['status'] }))}
                >
                  <option value="">Keep unchanged…</option>
                  <option value="active">Active</option>
                  <option value="planned">Planned</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="decommissioned">Decommissioned</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Power feed</label>
                <select
                  value={(bulkPatch.powerFeed as string) ?? ''}
                  onChange={(e) => setBulkPatch((p) => ({ ...p, powerFeed: (e.target.value || undefined) as Device['powerFeed'] }))}
                >
                  <option value="">Keep unchanged…</option>
                  <option value="A">Feed A (single)</option>
                  <option value="B">Feed B (single)</option>
                  <option value="AB">A + B (redundant)</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Owner</label>
                <input
                  value={(bulkPatch.owner as string) ?? ''}
                  placeholder="Keep unchanged…"
                  onChange={(e) => setBulkPatch((p) => ({ ...p, owner: e.target.value === '' ? undefined : e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label>Warranty expiry</label>
                <input
                  type="date"
                  value={(bulkPatch.warrantyExpiry as string) ?? ''}
                  onChange={(e) => setBulkPatch((p) => ({ ...p, warrantyExpiry: e.target.value === '' ? undefined : e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label>Asset tag prefix</label>
                <input
                  value={assetPrefix}
                  placeholder="e.g. DC1-R01"
                  onChange={(e) => setAssetPrefix(e.target.value)}
                />
                <button
                  className={styles.btn}
                  disabled={!assetPrefix.trim()}
                  onClick={assignAssetTags}
                  title="Assign sequential tags to selected devices (one undo)"
                >
                  Assign {selection.size} tags
                </button>
              </div>
              <div className={styles.rowBtns}>
                <button
                  className={`${styles.btn} ${styles.primary}`}
                  disabled={!hasBulkChanges(bulkPatch)}
                  onClick={applyBulk}
                  title="Apply the set fields to every selected device (one undo)"
                >
                  Apply to {selection.size}
                </button>
                <button className={styles.btn} onClick={() => s().select([])}>Clear selection</button>
              </div>
            </div>
          ) : selected ? (
            <>
              <div className={styles.deviceHero}>
                <span className={styles.thumbWrap}><GearThumb device={selected} /></span>
                <div>
                  <input
                    className={styles.nameInput}
                    value={selected.name}
                    aria-label="Device name"
                    onChange={(e) => renameSelected(e.target.value)}
                    onBlur={() => s().endEdit()}
                  />
                  <span>{selected.vendor || selected.model ? [selected.vendor, selected.model].filter(Boolean).join(' ') : selected.type}</span>
                  <div className={styles.completeness} title={selectedMissing.length ? `Missing ${selectedMissing.join(', ')}` : 'Inventory fields complete'}>
                    <span style={{ width: `${Math.round(((5 - selectedMissing.length) / 5) * 100)}%` }} />
                  </div>
                  <small>{selectedMissing.length ? `Missing ${selectedMissing.join(', ')}` : 'Inventory complete'}</small>
                </div>
              </div>
              <div className={styles.inspectorTabs} aria-label="Selected device sections">
                {(['placement', 'hardware', 'power', 'cabling', 'asset'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={inspectorTab === tab ? styles.activeTab : ''}
                    onClick={() => setInspectorTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {inspectorTab === 'placement' && (
                <div className={styles.inspectorPane}>
                  <div className={styles.kv}><span>Type</span><b>{selected.type}</b></div>
                  <div className={styles.kv}><span>Position</span><b>{slotOf(selected).mount === 'rail'
                    ? `U${selected.ru}–${selected.ru! + slotOf(selected).ruSpan - 1} · ${slotOf(selected).side} rail · ${railChannel(slotOf(selected))} channel`
                    : `U${selected.ru} · ${slotOf(selected).side} · ${slotOf(selected).bay}`}</b></div>
                  <div className={styles.kv}><span>Ports</span><b>{selected.interfaces?.length ?? 0}</b></div>
                  <div className={styles.rowBtns}>
                    <button className={styles.btn} title="Move up 1U (↑)" onClick={() => nudge(1)}>↑ U</button>
                    <button className={styles.btn} title="Move down 1U (↓)" onClick={() => nudge(-1)}>↓ U</button>
                    <button className={styles.btn} title="Unmount to the tray" onClick={() => { s().select([selected.id]); s().unmountFromRack(selected.id); }}>Unmount</button>
                    <button className={styles.btn} title="Delete (⌫)" onClick={deleteSelected}>Delete</button>
                  </div>
                  {racks.length > 1 && (
                    <div className={styles.field}>
                      <label>Move to rack</label>
                      <select
                        value={selected.rackId ?? ''}
                        onChange={(e) => moveDeviceToRack(selected.id, e.target.value)}
                        aria-label="Move device to another rack"
                      >
                        {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {inspectorTab === 'hardware' && (
                <div className={styles.inspectorPane}>
                  {catalogForType(selected.type).length > 0 && (
                    <div className={styles.field}>
                      <label>Hardware model</label>
                      <select value="" aria-label="Apply a catalog model" onChange={(e) => { if (e.target.value) applyCatalogModel(e.target.value); }}>
                        <option value="">Apply known model…</option>
                        {catalogForType(selected.type).map((m) => (
                          <option key={m.id} value={m.id}>{m.vendor} {m.model} ({catalogSpecLabel(m)})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className={styles.field}><label>Vendor</label><input value={selected.vendor ?? ''} onChange={(e) => updateSelected('vendor', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Model</label><input value={selected.model ?? ''} onChange={(e) => updateSelected('model', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Role</label><input value={selected.role ?? ''} onChange={(e) => updateSelected('role', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  {selected.type === 'generic' && (
                    <div className={styles.field}>
                      <label>Accessory</label>
                      <select
                        value={isCableManager(selected) ? 'cable-manager' : 'none'}
                        aria-label="Rack accessory"
                        title="A cable manager routes patch cords; on the 0U rail it runs vertically"
                        onChange={(e) => {
                          const on = e.target.value === 'cable-manager';
                          // Clearing a unit whose name reads like a manager ("cm-01") needs an explicit 'none'.
                          const off = isCableManager({ ...selected, rackAccessory: undefined }) ? 'none' : undefined;
                          updateSelected('rackAccessory', on ? 'cable-manager' : off);
                          commitSelectedEdit();
                        }}
                      >
                        <option value="none">None</option>
                        <option value="cable-manager">Cable manager</option>
                      </select>
                    </div>
                  )}
                  <div className={styles.field}>
                    <label>Airflow</label>
                    <select
                      value={selected.airflow ?? 'front-to-rear'}
                      aria-label="Airflow direction"
                      onChange={(e) => { updateSelected('airflow', (e.target.value === 'front-to-rear' ? undefined : e.target.value) as Device['airflow']); commitSelectedEdit(); }}
                    >
                      <option value="front-to-rear">Front → rear (standard)</option>
                      <option value="rear-to-front">Rear → front (reversed)</option>
                      <option value="side">Side / passive</option>
                    </select>
                  </div>
                  {(() => {
                    const photo = isRasterPhotoDataUri(selected.extra?.rackPhotoDataUri)
                      ? (selected.extra!.rackPhotoDataUri as string)
                      : null;
                    return (
                      <div className={styles.field}>
                        <label>Photo</label>
                        {photo ? (
                          <div className={styles.photoRow}>
                            <img className={styles.photoThumb} src={photo} alt={`${selected.name} photo`} />
                            <button
                              className={styles.btn}
                              onClick={() => { s().setDevicePhoto(selected.id, null); setPhotoError(null); }}
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <label className={styles.photoDrop}>
                            <span>Drop a photo or click — PNG/JPEG/WebP, ≤512 KB</span>
                            <input
                              type="file"
                              accept={PHOTO_ACCEPT}
                              hidden
                              onChange={(e) => { onPhotoFile(e.target.files?.[0]); e.target.value = ''; }}
                            />
                          </label>
                        )}
                        {photoError && <span className={styles.fieldError} role="alert">{photoError}</span>}
                      </div>
                    );
                  })()}
                </div>
              )}
              {inspectorTab === 'power' && (
                <div className={styles.inspectorPane}>
                  <div className={styles.field}><label>Watts</label><input type="number" value={selected.watts ?? ''} onChange={(e) => updateSelected('watts', (e.target.value === '' ? undefined : Number(e.target.value)) as Device['watts'])} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Weight (kg)</label><input type="number" value={selected.weightKg ?? ''} onChange={(e) => updateSelected('weightKg', (e.target.value === '' ? undefined : Number(e.target.value)) as Device['weightKg'])} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Depth (mm)</label><input type="number" min={0} value={selected.depthMm ?? ''} onChange={(e) => updateSelected('depthMm', (e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value)) as Device['depthMm'])} onBlur={commitSelectedEdit} aria-label="Depth (mm)" /></div>
                  <div className={styles.field}>
                    <label>{isPdu(selected) ? 'On feed' : isRackUps(selected) ? 'Backs feed' : 'Power feed'}</label>
                    <select value={selected.powerFeed ?? 'A'} onChange={(e) => { updateSelected('powerFeed', e.target.value as Device['powerFeed']); commitSelectedEdit(); }}>
                      <option value="A">{isPdu(selected) || isRackUps(selected) ? 'Feed A' : 'Feed A (single)'}</option>
                      <option value="B">{isPdu(selected) || isRackUps(selected) ? 'Feed B' : 'Feed B (single)'}</option>
                      {!isPdu(selected) && <option value="AB">{isRackUps(selected) ? 'Both (dual input, not checked)' : 'A + B (redundant)'}</option>}
                    </select>
                  </div>
                  {isRackUps(selected) && (
                    <div className={styles.field}><label>Output (W)</label><input type="number" min={0} value={selected.ratedWatts ?? ''} onChange={(e) => updateSelected('ratedWatts', (e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value)) as Device['ratedWatts'])} onBlur={commitSelectedEdit} aria-label="UPS output watts" placeholder="Nameplate W, not VA" /></div>
                  )}
                  {isRackUps(selected) && rackPower && selected.rackId === rackPower.rackId && (() => {
                    const l = rackPower.upsLoads.find((x) => x.upsIds.includes(selected.id));
                    if (!l) return <div className={styles.powerBalance}>{selected.powerFeed === 'AB' ? 'A dual-input UPS backs no single feed, so its load isn’t checked.' : 'Add its output rating to check the feed it backs.'}</div>;
                    const other = l.feed === 'A' ? 'B' : 'A';
                    const pct = (w: number) => ` (${Math.round((w / l.ratedW) * 100)}%)`;
                    return (
                      <div className={`${styles.powerBalance} ${l.failoverW > l.ratedW ? styles.powerOver : ''}`} aria-label="UPS load">
                        Feed {l.feed} load {kw(l.normalW)}{pct(l.normalW)} · {kw(l.failoverW)}{pct(l.failoverW)} if feed {other} fails · {kw(l.ratedW)} output{l.upsIds.length > 1 ? ` across ${l.upsIds.length} UPSes` : ''}
                      </div>
                    );
                  })()}
                  {isPdu(selected) && (
                    <div className={styles.field}>
                      <label>Rating</label>
                      <span className={styles.ratingPair}>
                        <input type="number" min={0} value={selected.ratedAmps ?? ''} onChange={(e) => updateSelected('ratedAmps', (e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value)) as Device['ratedAmps'])} onBlur={commitSelectedEdit} aria-label="Rated amps" placeholder="A" />
                        <span>A ×</span>
                        <input type="number" min={0} value={selected.ratedVolts ?? ''} onChange={(e) => updateSelected('ratedVolts', (e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value)) as Device['ratedVolts'])} onBlur={commitSelectedEdit} aria-label="Rated volts" placeholder="V" />
                        <span>V</span>
                      </span>
                    </div>
                  )}
                  {isPdu(selected) && (
                    <div className={styles.field}>
                      <label>Circuit</label>
                      <select value={selected.ratedPhases === 3 ? '3' : '1'} onChange={(e) => { updateSelected('ratedPhases', (e.target.value === '3' ? 3 : undefined) as Device['ratedPhases']); commitSelectedEdit(); }} aria-label="Circuit phases">
                        <option value="1">Single-phase</option>
                        <option value="3">Three-phase (volts line-to-line)</option>
                      </select>
                    </div>
                  )}
                  {isPdu(selected) && (() => {
                    const l = rackPower?.pduLoads.find((x) => x.pduId === selected.id);
                    if (!l) return null;
                    const other = l.feed === 'A' ? 'B' : 'A';
                    const pct = (w: number) => (l.ratedW ? ` (${Math.round((w / l.ratedW) * 100)}%)` : '');
                    const over = l.ratedW != null && l.failoverW > l.ratedW;
                    return (
                      <div className={`${styles.powerBalance} ${over ? styles.powerOver : ''}`} aria-label="PDU load">
                        Load {kw(l.normalW)}{pct(l.normalW)} · {kw(l.failoverW)}{pct(l.failoverW)} if feed {other} fails
                        {l.ratedW != null ? ` · rated ${kw(l.ratedW)}` : ' · add a rating to check it'}
                      </div>
                    );
                  })()}
                  {rackPower && selected.rackId === rackPower.rackId && (() => {
                    // This rack's feeds, not the whole fleet's.
                    const pf = powerFeedAnalysis(rackPower.devices);
                    return <div className={styles.powerBalance}>This rack: A {kw(pf.normalA)} · B {kw(pf.normalB)} · {pf.singleCorded} single-corded</div>;
                  })()}
                  {(() => {
                    // Where this unit's cords plug in, or what plugs into this PDU.
                    const nameOf = (id: string | null) => (id ? devices.find((d) => d.id === id)?.name ?? id : '');
                    if (isPdu(selected)) {
                      const used = new Map(powerCords.filter((c) => c.pduId === selected.id).map((c) => [c.outlet, c.deviceId]));
                      const outlets = selected.interfaces ?? [];
                      if (outlets.length === 0) return null;
                      return (
                        <div className={styles.cordList} aria-label="Power cords">
                          <small>Outlets · {used.size} of {outlets.length} used</small>
                          {outlets.map((o) => (
                            <span key={o.id}><b>{o.name}</b> {used.has(o.name) ? nameOf(used.get(o.name)!) : <i>free</i>}</span>
                          ))}
                        </div>
                      );
                    }
                    const mine = powerCords.filter((c) => c.deviceId === selected.id);
                    if (!cordsIntoPdu(selected) || mine.length === 0 || !powerCords.some((c) => c.pduId)) return null;
                    return (
                      <div className={styles.cordList} aria-label="Power cords">
                        <small>Plugs into</small>
                        {mine.map((c) => (
                          <span key={c.feed}><b>Feed {c.feed}</b> {c.pduId ? `${nameOf(c.pduId)} · ${c.outlet}` : <i>no free outlet</i>}</span>
                        ))}
                      </div>
                    );
                  })()}
                  {rackPower && rackFailures && selected.rackId === rackPower.rackId && (() => {
                    // What this unit does when each feed fails (the row view's failure lens, for one unit).
                    const fates = (['A', 'B'] as const).flatMap((f) => {
                      const t = unitFate(rackPower, selected.id, f, rackFailures[f]);
                      return t ? [{ f, t }] : [];
                    });
                    if (fates.length === 0) return null;
                    return (
                      <div className={styles.cordList} aria-label="If a feed fails">
                        <small>If a feed fails</small>
                        {fates.map(({ f, t }) => (
                          <span key={f} className={t.bad ? styles.fateBad : undefined}><b>Feed {f}</b> {t.text}</span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {inspectorTab === 'cabling' && (
                <div className={styles.inspectorPane}>
                  {deviceCableRows(selected.id).length === 0 && <div className={styles.emptyMicro}>No cables touch this device yet.</div>}
                  {deviceCableRows(selected.id).map((c) => {
                    const a = devices.find((d) => d.id === c.aEnd.deviceId);
                    const b = devices.find((d) => d.id === c.bEnd.deviceId);
                    const pn = (dev: typeof a, ifId: string) => dev?.interfaces?.find((i) => i.id === ifId)?.name ?? ifId;
                    return (
                      <div key={c.id} className={`${styles.cable} ${selCable === c.id ? styles.cableOn : ''}`} onClick={() => setSelCable(selCable === c.id ? null : c.id)}>
                        <span className={styles.sw} style={{ background: c.color }} />
                        <span className={styles.ep}>{a?.name}:{pn(a, c.aEnd.ifaceId)} → {b?.name}:{pn(b, c.bEnd.ifaceId)}</span>
                        {c.lengthFt != null && <span className={styles.lbl}>{c.lengthFt}ft</span>}
                      </div>
                    );
                  })}
                  <button className={styles.connectBtn} onClick={openConnectFromSelected}>+ Cable from this device…</button>
                </div>
              )}
              {inspectorTab === 'asset' && (
                <div className={styles.inspectorPane}>
                  <div className={styles.field}>
                    <label>Status</label>
                    <select value={selected.status ?? 'active'} onChange={(e) => { updateSelected('status', (e.target.value === 'active' ? undefined : e.target.value) as Device['status']); commitSelectedEdit(); }}>
                      <option value="active">Active</option>
                      <option value="planned">Planned</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="decommissioned">Decommissioned</option>
                    </select>
                  </div>
                  <div className={styles.field}><label>Serial</label><input value={selected.serial ?? ''} onChange={(e) => updateSelected('serial', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Asset tag</label><input value={selected.assetTag ?? ''} onChange={(e) => updateSelected('assetTag', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Owner</label><input value={selected.owner ?? ''} onChange={(e) => updateSelected('owner', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Warranty expiry</label><input type="date" value={selected.warrantyExpiry ?? ''} onChange={(e) => updateSelected('warrantyExpiry', e.target.value)} onBlur={commitSelectedEdit} /></div>
                  <div className={styles.field}><label>Notes</label><textarea value={selected.notes ?? ''} onChange={(e) => updateSelected('notes', e.target.value)} onBlur={commitSelectedEdit} /></div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyMicro}>
              {armed
                ? `Click a U slot to drop ${armed.label}, or drag it from the left.`
                : 'Select gear to manage it, or drag equipment from the library to build the rack.'}
            </div>
          )}
        </div>
        <div className={styles.sec}>
          <h3>
            Smart suggestions · {insights.length}
            {cables.some((c) => c.lengthFt == null) && (
              <button
                className={styles.btn}
                style={{ float: 'right', fontSize: 11 }}
                title="Apply every non-destructive fix at once (currently: estimate missing cable lengths). One undo."
                onClick={() => s().autoLengthRackCables()}
              >
                Fix all safe
              </button>
            )}
          </h3>
          {INSIGHT_GROUPS.map((group) => {
            const items = groupedInsights.get(group) ?? [];
            if (!items.length) return null;
            return (
              <div key={group} className={styles.insightGroup}>
                <div className={styles.insightGroupHead}>
                  <b>{group}</b>
                  <span>{items.length}</span>
                </div>
                {items.slice(0, 4).map((insight) => (
                  <div key={insight.id} className={`${styles.insight} ${styles[`insight_${insight.severity}`]}`}>
                    <div>
                      <b>{insight.title}</b>
                      <span>{insight.detail}</span>
                      <em>{group === 'Critical' ? 'Prevents install-day surprises.' : group === 'Inventory' ? 'Keeps audit and labels complete.' : group === 'Cabling' ? 'Keeps schedule, export, and rack view aligned.' : 'Improves planning confidence.'}</em>
                    </div>
                    <button className={styles.btn} onClick={() => handleInsight(insight)}>{insight.actionLabel}</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
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
            {patchable > 0 && (
              <button
                className={styles.btn}
                style={{ float: 'right', fontSize: 11, marginRight: 4 }}
                title="Cable every link between rack-mounted gear: free ports, P-### labels, estimated lengths. One undo."
                onClick={() => s().patchFromTopology()}
              >
                Patch {patchable} from topology
              </button>
            )}
          </h3>
          {rackFill.length > 0 && (
            <div className={styles.laneFill} aria-label="Cable managers">
              {rackFill.map((f) => (
                f.capacity == null ? (
                  <span
                    key={f.manager.id}
                    title={`${f.manager.name} carries ${f.cables} cords along ${managerSpanLabel(f.manager)}. Size it with the vendor's capacity calculator.`}
                  >
                    {f.manager.name} {managerSpanLabel(f.manager)} · {f.cables}
                  </span>
                ) : (
                  <span
                    key={f.manager.id}
                    className={f.cables > f.capacity ? styles.laneOver : undefined}
                    title={`${f.manager.name} at U${f.manager.ru} dresses ${f.cables} of about ${f.capacity} cords`}
                  >
                    {f.manager.name} U{f.manager.ru} · {f.cables}/{f.capacity}
                  </span>
                )
              ))}
            </div>
          )}
          {cables.length === 0 && (
            <div className={styles.emptyMicro}>No cables yet.</div>
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
                {!!lanes.routes.get(c.id)?.length && (
                  <span className={styles.route}>via {routeLabel(lanes.routes.get(c.id)!)}</span>
                )}
              </div>
            );
          })}
          <button className={styles.connectBtn} onClick={openConnectFromSelected}>+ Connect ports…</button>
        </div>
      </div>

      {exportOpen && handoff && (
        <div className={styles.exportBackdrop} onClick={() => setExportOpen(false)}>
          <div className={styles.exportDrawer} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export handoff">
            <div className={styles.exportHead}>
              <div>
                <h3>Export handoff</h3>
                <p data-testid="export-scope-summary">{handoff.label} · {handoff.mounted.length} devices · {cableCountLabel(handoff)}</p>
              </div>
              <button className={styles.x} aria-label="Close export drawer" onClick={() => setExportOpen(false)}>×</button>
            </div>
            <div className={styles.field}>
              <label>Covers</label>
              <div className={styles.seg} role="group" aria-label="Export scope">
                <button className={exportScope === 'rack' ? styles.on : ''} aria-pressed={exportScope === 'rack'} onClick={() => setExportScope('rack')}>
                  This rack · {rack.name}
                </button>
                <button className={exportScope === 'fleet' ? styles.on : ''} aria-pressed={exportScope === 'fleet'} onClick={() => setExportScope('fleet')}>
                  All racks · {racks.length}
                </button>
              </div>
            </div>
            {exportNote && (
              <div className={exportNote.kind === 'error' ? styles.exportError : styles.exportBusy} role={exportNote.kind === 'error' ? 'alert' : 'status'}>
                <span>{exportNote.text}</span>
                {exportNote.retry && (
                  <div className={styles.rowBtns}>
                    <button className={styles.btn} onClick={exportNote.retry}>Retry</button>
                    <button className={styles.btn} onClick={() => setExportNote(null)}>Dismiss</button>
                  </div>
                )}
              </div>
            )}
            <div className={styles.field}>
              <label>Diagram content</label>
              <select value={exportMode} onChange={(e) => setExportMode(e.target.value as ExportMode)}>
                <option value="diagram">Diagram</option>
                <option value="diagram+table">Diagram + cable table</option>
                <option value="table-only">Cable table only</option>
              </select>
            </div>
            <div className={styles.exportPresetGrid}>
              <div className={styles.exportPreset}>
                <b>Install packet</b>
                <span>Rack elevation plus cable, power-cord and power-strip tables for field work.</span>
                <small className={styles.exportScope}>
                  {handoff.label}: {cableCountLabel(handoff)}{handoff.kind === 'rack' && handoff.crossRack ? ', far rack named' : ''} → {handoffFileName(handoff, 'install-packet', 'pdf')}
                </small>
                <div className={styles.rowBtns}>
                  <button className={styles.btn} onClick={() => { setExportMode('diagram+table'); exportPdf('diagram+table'); }}>PDF</button>
                  <button className={styles.btn} onClick={() => { setExportMode('diagram+table'); exportPng('diagram+table'); }}>PNG</button>
                </div>
              </div>
              <div className={styles.exportPreset}>
                <b>Cable schedule</b>
                <span>Endpoint list with color, label, and length, plus each power cord's PDU outlet and each strip's load.</span>
                <small className={styles.exportScope}>
                  {handoff.label}: {cableCountLabel(handoff)} → {handoffFileName(handoff, 'cables', 'csv')}
                </small>
                <div className={styles.rowBtns}>
                  <button className={styles.btn} onClick={exportCsv}>CSV</button>
                  <button className={styles.btn} title="Which PDU outlet each unit's power cords plug into" onClick={exportPowerCords}>Power cords</button>
                  <button className={styles.btn} title="Each PDU's rating and load, now and if the other feed fails" onClick={exportPowerStrips}>Power strips</button>
                  <button className={styles.btn} onClick={() => s().autoLengthRackCables()}>Auto-length</button>
                </div>
              </div>
              <div className={styles.exportPreset}>
                <b>Inventory audit</b>
                <span>BOM plus printable device labels.</span>
                <small className={styles.exportScope}>
                  BOM: {handoff.bom.label}, {handoff.bom.devices.length} device{handoff.bom.devices.length === 1 ? '' : 's'} → {handoffFileName(handoff, 'bom', 'csv')} · Labels: {handoff.label}, {handoff.mounted.filter((d) => d.ru != null).length} → {handoffFileName(handoff, 'labels', 'png')}
                </small>
                <div className={styles.rowBtns}>
                  <button className={styles.btn} onClick={exportBom}>BOM</button>
                  <button className={styles.btn} onClick={exportLabels}>Labels</button>
                </div>
              </div>
              <div className={styles.exportPreset}>
                <b>Rack elevation</b>
                <span>Visible rack artwork for diagrams and reviews.</span>
                <small className={styles.exportScope}>
                  {handoff.label}{view === 'focus' && handoff.kind === 'rack' ? `, ${side} face` : ''} → {handoffFileName(handoff, exportMode === 'diagram' ? 'elevation' : 'install-packet', 'png')}
                </small>
                <div className={styles.rowBtns}>
                  <button className={styles.btn} onClick={() => exportPdf()}>PDF</button>
                  <button className={`${styles.btn} ${styles.primary}`} onClick={() => exportPng()}>PNG</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {connecting && (
        <ConnectPortsDialog
          rackId={rack.id}
          initialA={connectingFrom}
          onClose={() => {
            setConnecting(false);
            setConnectingFrom(undefined);
          }}
        />
      )}
    </div>
  );
}
