/**
 * Smart, non-blocking rack-management suggestions for the ops cockpit.
 *
 * This layer is intentionally pure and schema-free: it derives actionable guidance from
 * existing racks/devices/cables without introducing new persisted fields.
 */
import type { Device, Rack, RackCable, ValidationIssue } from '@/model/types';
import { fleetBudget, rackBudget } from './rackBudget';
import { powerFeedAnalysis } from './rackPower';
import { nearestFreeU, slotOf } from './rackModel';

export type RackInsightSeverity = 'ok' | 'info' | 'warn' | 'error';
export type RackInsightAction =
  | 'add-asset-tag'
  | 'auto-length'
  | 'balance-power'
  | 'go-to-u'
  | 'review-health'
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
