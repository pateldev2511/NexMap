/**
 * Smart, non-blocking rack-management suggestions for the ops cockpit.
 *
 * This layer is intentionally pure and schema-free: it derives actionable guidance from
 * existing racks/devices/cables without introducing new persisted fields.
 */
import type { Device, Rack, RackCable, ValidationIssue } from '@/model/types';
import { fleetBudget, rackBudget } from './rackBudget';
import { pduFeedCoverage, powerFeedAnalysis } from './rackPower';
import { airflowViolations } from './rackAirflow';
import { isFullDepth, nearestFreeU, slotOf } from './rackModel';
import { planCatalogDepths } from './rackCatalog';
import { cableLanes, MANAGER_REACH_U } from './cableLanes';
import { analyzeRackPower, devicesByRack, kw, loadStatus, pduRatingLabel } from './powerCords';

export type RackInsightSeverity = 'ok' | 'info' | 'warn' | 'error';
export type RackInsightAction =
  | 'add-asset-tag'
  | 'add-pdu'
  | 'auto-length'
  | 'balance-power'
  | 'fill-depths'
  | 'go-to-u'
  | 'review-health'
  | 'review-pdu'
  | 'review-rack';

export interface RackInsight {
  id: string;
  title: string;
  detail: string;
  severity: RackInsightSeverity;
  action: RackInsightAction;
  actionLabel: string;
  rackId?: string;
  deviceId?: string;
  cableId?: string;
  targetU?: number;
  objectIds?: string[];
}

export interface RackInsightsInput {
  racks: Rack[];
  devices: Device[];
  cables: RackCable[];
  issues?: ValidationIssue[];
  activeRackId?: string;
  selectedDeviceId?: string | null;
}

const rank: Record<RackInsightSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
  ok: 3,
};

function deviceName(devices: Device[], id: string): string {
  return devices.find((d) => d.id === id)?.name ?? id;
}

function nearestMoveTarget(device: Device, rack: Rack, devices: Device[]): number | null {
  const slot = slotOf(device);
  const occupants = devices.filter((d) => d.rackId === rack.id);
  return nearestFreeU(
    rack,
    occupants,
    slot.ruSpan,
    slot.ru,
    slot.side,
    slot.bay,
    slot.depth,
    device.id,
  );
}

export function rackInsights({
  racks,
  devices,
  cables,
  issues = [],
  activeRackId,
  selectedDeviceId,
}: RackInsightsInput): RackInsight[] {
  const insights: RackInsight[] = [];
  const selected = selectedDeviceId ? devices.find((d) => d.id === selectedDeviceId) : undefined;
  const selectedRack = selected?.rackId ? racks.find((r) => r.id === selected.rackId) : undefined;
  const activeRack = activeRackId ? racks.find((r) => r.id === activeRackId) : undefined;

  const fleet = fleetBudget(racks, devices);
  if (fleet.anyOver) {
    const over = racks.find((r) => {
      const b = rackBudget(r, devices);
      return b.overWatts || b.overWeight;
    });
    insights.push({
      id: `capacity-${over?.id ?? 'fleet'}`,
      title: 'Capacity limit exceeded',
      detail: over ? `${over.name} is over its configured power or weight cap.` : 'One rack is over its configured cap.',
      severity: 'error',
      action: 'review-rack',
      actionLabel: 'Review rack',
      rackId: over?.id,
    });
  }

  // Depth: gear that doesn't fit front-to-rear (warn — the designer never blocks it).
  const deep = racks.find((r) => rackBudget(r, devices).overDepth);
  if (deep) {
    const b = rackBudget(deep, devices);
    insights.push({
      id: `depth-${deep.id}`,
      title: b.tooDeep > 0 ? 'Gear deeper than the rack' : 'Front and rear gear too deep together',
      detail:
        b.tooDeep > 0
          ? `${deep.name}: ${b.tooDeep} unit${b.tooDeep === 1 ? ' is' : 's are'} deeper than its ${b.depthMm} mm.`
          : `${deep.name}: a front and a rear unit share a U but don't fit its ${b.depthMm} mm together.`,
      severity: 'warn',
      action: 'review-rack',
      actionLabel: 'Review rack',
      rackId: deep.id,
    });
  }

  // Depth the check can't see: a rack with a depth holding full-depth gear that records
  // none. Silence there would read as "fits"; say so, and fill what the catalog knows.
  const fillable = new Set(planCatalogDepths(devices).map((f) => f.deviceId));
  for (const rack of racks) {
    if (!rack.depthMm) continue;
    const unknown = devices.filter(
      (d) =>
        d.rackId === rack.id &&
        d.ru != null &&
        (d.mount ?? 'rack') === 'rack' &&
        isFullDepth(d.type) &&
        !(d.depthMm && d.depthMm > 0),
    );
    if (!unknown.length) continue;
    const known = unknown.filter((d) => fillable.has(d.id));
    const n = unknown.length;
    insights.push({
      id: `depth-unchecked-${rack.id}`,
      title: `Depth not checked for ${n} unit${n === 1 ? '' : 's'}`,
      detail: known.length
        ? `${rack.name}: ${known.length} of them ${known.length === 1 ? 'is a catalog model' : 'are catalog models'} with a datasheet depth.`
        : `${rack.name}: add a depth or apply a known model to check them against its ${rack.depthMm} mm.`,
      severity: 'info',
      action: known.length ? 'fill-depths' : 'review-rack',
      actionLabel: known.length ? 'Fill depths' : 'Review rack',
      rackId: rack.id,
      objectIds: unknown.map((d) => d.id),
    });
    break;
  }

  const power = powerFeedAnalysis(devices);
  const totalFeed = power.normalA + power.normalB;
  if (totalFeed > 0) {
    const diff = Math.abs(power.normalA - power.normalB);
    const pct = diff / totalFeed;
    if (pct >= 0.25) {
      const hot = power.normalA > power.normalB ? 'A' : 'B';
      insights.push({
        id: 'power-imbalance',
        title: 'A/B power imbalance',
        detail: `Feed ${hot} is ${Math.round(pct * 100)}% higher than the other feed.`,
        severity: 'warn',
        action: 'balance-power',
        actionLabel: 'Balance now',
      });
    }
    if (power.singleCorded > 0) {
      insights.push({
        id: 'single-corded',
        title: `${power.singleCorded} single-corded device${power.singleCorded === 1 ? '' : 's'}`,
        detail: 'Single-corded gear has no A/B power redundancy.',
        severity: 'warn',
        action: 'balance-power',
        actionLabel: 'Review power',
      });
    }
  }

  // PDUs: gear that needs a feed no PDU in its rack is on, or more cords than outlets.
  // Racks without any PDU drawn are left alone (their power isn't modelled).
  // Each rack's own units, grouped once: the per-rack power checks below never scan the fleet.
  const byRack = devicesByRack(devices);
  for (const rack of racks) {
    const coverage = pduFeedCoverage(rack, byRack.get(rack.id) ?? []);
    if (!coverage.some((f) => f.pdus > 0)) continue;
    for (const f of coverage) {
      if (f.cords === 0) continue;
      const units = `${f.cords} unit${f.cords === 1 ? '' : 's'}`;
      if (f.pdus === 0) {
        insights.push({
          id: `pdu-missing-${rack.id}-${f.feed}`,
          title: `No PDU on feed ${f.feed}`,
          detail: `${rack.name}: ${units} need${f.cords === 1 ? 's' : ''} a cord on feed ${f.feed}, but none of its PDUs is on it.`,
          severity: 'warn',
          action: 'add-pdu',
          actionLabel: `Add PDU ${f.feed}`,
          rackId: rack.id,
          objectIds: f.deviceIds,
        });
      } else if (f.cords > f.outlets) {
        insights.push({
          id: `pdu-outlets-${rack.id}-${f.feed}`,
          title: `Feed ${f.feed} is short of outlets`,
          detail: `${rack.name}: ${f.cords} cords on feed ${f.feed}, ${f.outlets} outlets across its ${f.pdus === 1 ? 'PDU' : `${f.pdus} PDUs`}.`,
          severity: 'warn',
          action: 'add-pdu',
          actionLabel: `Add PDU ${f.feed}`,
          rackId: rack.id,
          objectIds: f.deviceIds,
        });
      }
    }
  }

  // PDU and UPS load against its rating: over it now, over it if the other feed fails
  // (every dual-corded unit shifts its full draw onto the survivor), or past 80% then.
  // Strips and UPSes without a rating aren't checked.
  for (const rack of racks) {
    const power = analyzeRackPower(rack, byRack.get(rack.id) ?? []);
    const checks = [
      ...power.pduLoads.map((l) => ({ l, ids: [l.pduId], verb: 'trips' as const })),
      ...power.upsLoads.map((l) => ({ l, ids: l.upsIds, verb: 'overloads' as const })),
    ];
    for (const { l, ids, verb } of checks) {
      if (l.ratedW == null) continue;
      const status = loadStatus(l, verb);
      if (status === 'ok') continue;
      const first = power.byId.get(ids[0]!)!;
      const name = ids.map((id) => power.byId.get(id)?.name ?? id).join(' + ');
      const other = l.feed === 'A' ? 'B' : 'A';
      const rated = verb === 'trips' ? `${kw(l.ratedW)} (${pduRatingLabel(first)})` : `${kw(l.ratedW)} of UPS output`;
      const base = { action: 'review-pdu' as const, actionLabel: verb === 'trips' ? 'Review PDU' : 'Review UPS', rackId: rack.id, deviceId: first.id };
      if (status === 'over its rating') {
        insights.push({
          ...base,
          id: `${verb === 'trips' ? 'pdu' : 'ups'}-over-${first.id}`,
          title: `${name} ${ids.length > 1 ? 'are' : 'is'} over ${ids.length > 1 ? 'their' : 'its'} rating`,
          detail: verb === 'trips'
            ? `${rack.name}: ${kw(l.normalW)} on a ${rated} strip.`
            : `${rack.name}: ${kw(l.normalW)} on feed ${l.feed}, against ${rated}.`,
          severity: 'warn',
        });
      } else if (status.startsWith(verb)) {
        insights.push({
          ...base,
          id: `${verb === 'trips' ? 'pdu-failover' : 'ups-failover'}-${first.id}`,
          title: `${name} ${verb === 'trips' ? (ids.length > 1 ? 'trip' : 'trips') : ids.length > 1 ? 'overload' : 'overloads'} if feed ${other} fails`,
          detail: verb === 'trips'
            ? `${rack.name}: ${kw(l.failoverW)} lands on it when feed ${other} goes; it's rated ${rated}.`
            : `${rack.name}: ${kw(l.failoverW)} lands on feed ${l.feed} when feed ${other} goes, against ${rated}.`,
          severity: 'warn',
        });
      } else {
        insights.push({
          ...base,
          id: `${verb === 'trips' ? 'pdu' : 'ups'}-80-${first.id}`,
          title: `${name} ${ids.length > 1 ? 'run' : 'runs'} past 80% if feed ${other} fails`,
          detail: `${rack.name}: ${Math.round((l.failoverW / l.ratedW) * 100)}% of ${rated}. Many electrical codes cap continuous load at 80%.`,
          severity: 'info',
        });
      }
    }
  }

  // Cable management: an overfull manager, or dense gear with nowhere to dress its cords.
  const lanes = cableLanes(devices, cables);
  const full = lanes.fill.find((f) => f.capacity != null && f.cables > f.capacity);
  if (full) {
    const m = full.manager;
    insights.push({
      id: `cable-mgr-full-${m.id}`,
      title: 'Cable manager over capacity',
      detail: `${m.name} at U${m.ru} dresses ${full.cables} cords; a ${m.ruSpan ?? 1}U manager holds about ${full.capacity}.`,
      severity: 'warn',
      action: 'review-rack',
      actionLabel: 'Review',
      rackId: m.rackId,
      deviceId: m.id,
    });
  }
  const loose = lanes.unmanaged[0];
  if (loose) {
    insights.push({
      id: `unmanaged-${loose.device.id}`,
      title: 'Dense gear without a cable manager',
      detail: `${loose.device.name} has ${loose.cables} cords and no cable manager within ${MANAGER_REACH_U}U.`,
      severity: 'info',
      action: 'review-rack',
      actionLabel: 'Review',
      rackId: loose.device.rackId,
      deviceId: loose.device.id,
    });
  }

  const missingLength = cables.filter((c) => c.lengthFt == null);
  if (missingLength.length > 0) {
    insights.push({
      id: 'missing-cable-lengths',
      title: 'Cable length suggestions',
      detail: `${missingLength.length} cable${missingLength.length === 1 ? '' : 's'} missing estimated length.`,
      severity: 'info',
      action: 'auto-length',
      actionLabel: 'Auto-length',
      cableId: missingLength[0]?.id,
    });
  }

  if (issues.length > 0) {
    const first = issues[0]!;
    insights.push({
      id: `health-${first.id}`,
      title: 'Cabling health needs review',
      detail: first.message,
      severity: first.severity === 'error' || first.severity === 'critical' ? 'error' : 'warn',
      action: 'review-health',
      actionLabel: 'Review issue',
      objectIds: first.objectIds,
    });
  }

  if (activeRack) {
    const inActive = devices.filter((d) => d.rackId === activeRack.id);
    const viol = airflowViolations(inActive);
    if (viol.length > 0) {
      const dir = viol[0]!.dominant === 'front-to-rear' ? 'front→rear' : 'rear→front';
      insights.push({
        id: `airflow-${activeRack.id}`,
        title: `${viol.length} device${viol.length === 1 ? '' : 's'} fight the airflow`,
        detail: `Reversed vs the rack's ${dir} flow — exhaust blows into neighbours' intake (hot-aisle risk).`,
        severity: 'warn',
        action: 'review-rack',
        actionLabel: 'Review',
        rackId: activeRack.id,
        deviceId: viol[0]!.deviceId,
      });
    }
  }

  if (selected) {
    if (!selected.assetTag?.trim()) {
      insights.push({
        id: `asset-${selected.id}`,
        title: 'Missing asset tag',
        detail: `${selected.name} has no asset tag for inventory handoff.`,
        severity: 'warn',
        action: 'add-asset-tag',
        actionLabel: 'Add tag',
        deviceId: selected.id,
      });
    }
    if (!selected.vendor || !selected.model) {
      insights.push({
        id: `model-${selected.id}`,
        title: 'Hardware model not set',
        detail: 'Apply a catalog model to fill vendor, power, and weight.',
        severity: 'info',
        action: 'review-rack',
        actionLabel: 'Edit hardware',
        deviceId: selected.id,
      });
    }
    if (selectedRack) {
      const targetU = nearestMoveTarget(selected, selectedRack, devices);
      if (targetU != null) {
        insights.push({
          id: `fit-${selected.id}-${targetU}`,
          title: 'Best free U',
          detail: `Nearest valid fit for ${selected.name} is U${targetU} in ${selectedRack.name}.`,
          severity: 'ok',
          action: 'go-to-u',
          actionLabel: `Go to U${targetU}`,
          rackId: selectedRack.id,
          deviceId: selected.id,
          targetU,
        });
      }
    }
  } else if (activeRack) {
    const b = rackBudget(activeRack, devices);
    if (b.freeU > 0) {
      insights.push({
        id: `free-${activeRack.id}`,
        title: `${b.freeU}U free in ${activeRack.name}`,
        detail: `${activeRack.name} is ${Math.round(b.pct * 100)}% occupied.`,
        severity: 'ok',
        action: 'review-rack',
        actionLabel: 'Review rack',
        rackId: activeRack.id,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: 'clean',
      title: 'Rack plan looks healthy',
      detail: 'No capacity, cabling, or inventory suggestions right now.',
      severity: 'ok',
      action: 'review-rack',
      actionLabel: 'Review',
    });
  }

  return insights.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}

export function insightTargetDevice(insight: RackInsight, devices: Device[]): string | null {
  if (insight.deviceId) return insight.deviceId;
  const objectId = insight.objectIds?.find((id) => devices.some((d) => d.id === id));
  return objectId ?? null;
}

export function insightSummary(insight: RackInsight, devices: Device[]): string {
  if (insight.deviceId) return `${insight.title}: ${deviceName(devices, insight.deviceId)}`;
  return insight.title;
}
