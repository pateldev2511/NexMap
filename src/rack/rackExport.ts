/**
 * What each Export handoff artifact covers, so its contents, its counts in the drawer and
 * its filename all agree. Pure; the drawer only downloads what these build.
 *
 * A rack scope is one installation: that rack's gear, power and labels, and every cable
 * with an end in it — its local runs plus its cross-rack runs, listed from its side with
 * the far rack named. Runs wholly inside another rack stay out. The fleet scope is its own,
 * explicitly named export ("all-racks"); the fleet BOM is every device in the project
 * (unplaced gear still has to be bought), so it is named "project".
 */
import type { Device, Rack, RackCable, TextObject } from '@/model/types';
import {
  buildConnectionsTableSvg,
  buildPowerCordsTableSvg,
  buildPowerStripsTableSvg,
  buildRackRowFacesSvg,
  buildRackSvg,
  cableScheduleRows,
  composeExport,
  powerCordRows,
  vstackSvg,
  type CableScheduleOptions,
  type ExportMode,
} from './buildRackSvg';
import { orderRacks } from './rackModel';

export type ExportScopeKind = 'rack' | 'fleet';

export interface HandoffScope {
  kind: ExportScopeKind;
  /** Shown in the drawer and on the sheets: the rack's name, or "All 3 racks". */
  label: string;
  /** Filename stem: the rack's name, or "all-racks". */
  fileBase: string;
  /** The focused rack, for a rack scope. */
  rack?: Rack;
  racks: Rack[];
  /** Gear mounted in `racks`. */
  mounted: Device[];
  /** Cables with an end in `racks` (the fleet: every cable). */
  cables: RackCable[];
  /** How many of `cables` run between two racks. */
  crossRack: number;
  /** The bill of materials: the rack's gear, or every device in the project. */
  bom: { devices: Device[]; label: string; fileBase: string };
  /** Schedule options that name the far rack (and, for one rack, list its end first). */
  schedule: CableScheduleOptions;
}

/** Characters a download name can't carry on some OS. */
const safeName = (s: string) => s.replace(/[/\\:*?"<>|]+/g, '-').trim() || 'rack';

export function handoffScope(
  kind: ExportScopeKind,
  rack: Rack | undefined,
  racks: readonly Rack[],
  devices: readonly Device[],
  cables: readonly RackCable[],
): HandoffScope {
  const ordered = orderRacks([...racks]);
  const scoped = kind === 'rack' && rack ? [rack] : ordered;
  const ids = new Set(scoped.map((r) => r.id));
  const rackOf = new Map(devices.map((d) => [d.id, d.rackId]));
  const inScope = (deviceId: string) => {
    const r = rackOf.get(deviceId);
    return r != null && ids.has(r);
  };
  const mounted = devices.filter((d) => d.rackId != null && ids.has(d.rackId));
  const scopedCables = kind === 'rack' && rack
    ? cables.filter((c) => inScope(c.aEnd.deviceId) || inScope(c.bEnd.deviceId))
    : [...cables];
  const crossRack = scopedCables.filter((c) => {
    const a = rackOf.get(c.aEnd.deviceId);
    const b = rackOf.get(c.bEnd.deviceId);
    return a != null && b != null && a !== b;
  }).length;
  if (kind === 'rack' && rack) {
    return {
      kind,
      label: rack.name,
      fileBase: safeName(rack.name),
      rack,
      racks: scoped,
      mounted,
      cables: scopedCables,
      crossRack,
      bom: { devices: mounted, label: rack.name, fileBase: safeName(rack.name) },
      schedule: { racks: ordered, homeRackId: rack.id },
    };
  }
  return {
    kind: 'fleet',
    label: `All ${ordered.length} rack${ordered.length === 1 ? '' : 's'}`,
    fileBase: 'all-racks',
    racks: ordered,
    mounted,
    cables: scopedCables,
    crossRack,
    bom: { devices: [...devices], label: 'Whole project', fileBase: 'project' },
    schedule: { racks: ordered },
  };
}

export type HandoffArtifact = 'elevation' | 'install-packet' | 'cables' | 'power-cords' | 'power-strips' | 'labels' | 'bom';

/** The download name for one artifact, from the scope it actually covers. */
export function handoffFileName(h: HandoffScope, artifact: HandoffArtifact, ext: string): string {
  if (artifact === 'bom') return `${h.bom.fileBase}-bom.${ext}`;
  return artifact === 'elevation' ? `${h.fileBase}.${ext}` : `${h.fileBase}-${artifact}.${ext}`;
}

/** "3 cables (1 cross-rack)" — the drawer's per-artifact count. */
export function cableCountLabel(h: HandoffScope): string {
  const n = h.cables.length;
  return `${n} cable${n === 1 ? '' : 's'}${h.crossRack ? ` (${h.crossRack} cross-rack)` : ''}`;
}

export interface HandoffSvgOptions {
  mode: ExportMode;
  background: string;
  /** A one-rack scope drawn as the focused editor shows it: one face. */
  singleFace?: { side: 'front' | 'rear' };
  showRear: boolean;
  callouts: TextObject[];
}

/** The elevation, plus (per `mode`) the scope's connection, power-cord and power-strip tables. */
export function buildHandoffSvg(h: HandoffScope, devices: Device[], cables: RackCable[], opts: HandoffSvgOptions): string {
  const { background } = opts;
  const rackSvg = h.rack && opts.singleFace
    ? buildRackSvg(h.rack, devices, cables, { background, side: opts.singleFace.side, callouts: opts.callouts })
    : buildRackRowFacesSvg(h.racks, devices, cables, { showRear: opts.showRear, background, callouts: opts.callouts });
  if (opts.mode === 'diagram') return rackSvg;
  const connections = buildConnectionsTableSvg(cableScheduleRows(devices, h.cables, h.schedule), {
    background,
    title: `Connections · ${h.label} · ${cableCountLabel(h)}`,
  });
  // Racks with PDUs add where each power cord plugs in, under the connections.
  const cords = powerCordRows(h.racks, devices);
  let tableSvg = cords.length > 0
    ? vstackSvg(connections, buildPowerCordsTableSvg(cords, { background, title: `Power cords · ${h.label}` }), background)
    : connections;
  // …then each strip's rating and load, and what a feed failure takes down.
  const strips = buildPowerStripsTableSvg(h.racks, devices, { background, title: `Power strips · ${h.label}` });
  if (strips) tableSvg = vstackSvg(tableSvg, strips, background);
  return composeExport(rackSvg, tableSvg, opts.mode, background);
}

/** What to tell someone whose export didn't render: what failed, why, and what to try. */
export function exportFailureMessage(what: string, err: unknown, h: HandoffScope): string {
  // Trimmed: the reason sits inside parentheses mid-sentence.
  const why = err instanceof Error && err.message ? err.message.replace(/[.\s]+$/, '') : 'the browser gave no reason';
  const instead = h.kind === 'fleet' && h.racks.length > 1
    ? 'export one rack at a time — a very large sheet can pass the browser’s canvas limit'
    : 'export the CSV schedule instead';
  return `Couldn’t export ${what} (${why}). Nothing was downloaded — retry, or ${instead}.`;
}
