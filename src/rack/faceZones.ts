/**
 * Faceplate zone geometry — pure, no React, no SVG.
 *
 * WHY THIS EXISTS: the server faceplate used to place its ports, vent slats, fans
 * and drive bays from four independent sets of magic numbers. They collided. A
 * measured audit found RJ45 jacks drawn ON TOP of vent slats on every 1U server
 * (up to 9 jacks on a Dell/HPE skin) and ON TOP of fan bodies at 2U and above.
 *
 * The fix is structural, not a nudge: this module carves the panel into DISJOINT
 * zones, and both the port layout and the artwork derive from them. Ports own
 * `ports` and nothing else may be drawn inside it, so the collision cannot come
 * back the next time a port count or a chassis height changes.
 *
 * Both art paths consume this — the generic art in `rackDeviceArt.ts` AND the
 * per-vendor skins in `rackPhotoSkins.ts` — because the audit found the same bug
 * in both, and two copies of the geometry is how it got there.
 */
import type { Rect } from './rackLayout';

/**
 * Left strip: name, status LCD, power button.
 *
 * Wide enough for a full model string ("Dell PowerEdge R650") because a server
 * faceplate has few ports and plenty of spare width — a narrow margin forced the
 * name to truncate to a few characters for no benefit.
 */
const LABEL_W = 146;
/** Gap between the drive bezel and the chassis right edge. */
const RIGHT_PAD = 9;
/** Height of the vent strip, when the chassis is tall enough to have one. */
const VENT_H = 7;
/** Below this panel height there is no room for vents OUTSIDE the port band. */
const VENT_MIN_H = 44;
/** Never squeeze the port band below this width, whatever else wants space. */
const MIN_PORT_W = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface FaceZones {
  /** Name label, status LCD, power button. */
  label: Rect;
  /** RESERVED for ports. Nothing else may be drawn here. */
  ports: Rect;
  /** Cooling. Horizontally disjoint from `ports`, so fan radius can never reach a jack. */
  fans: Rect;
  /** Drive-bay bezel. */
  drives: Rect;
  /**
   * Vent slats, or null when the chassis is too short to fit them outside the port
   * band. A 1U server's front is bezel and drive bays in reality — its perforation
   * is part of the bezel, not a separate slat block — so dropping the strip at 1U
   * is more correct than cramming it over the ports.
   */
  vents: Rect | null;
  /** True for a chassis tall enough for two drive rows / three fans. */
  tall: boolean;
}

/**
 * Carve a server/storage faceplate into non-overlapping zones.
 *
 * Order of claims, left to right: label → ports → fans → drives. Ports are
 * claimed BEFORE cooling so a wide drive bezel steals from the fans, never from
 * the ports.
 */
export function serverFaceZones(p: Rect): FaceZones {
  const tall = p.h >= 52;

  // A SEQUENTIAL allocator, not fixed widths. Fixed widths broke on a half-bay
  // panel: a 146px label plus a 42%-width drive bezel left less than the port
  // minimum, and `max(MIN_PORT_W, …)` then pushed the ports into the fans. Here each
  // zone is carved out of what genuinely remains, so disjointness holds at any width.
  const labelW = clamp(p.w * 0.26, 56, 146);
  const right = p.x + p.w - RIGHT_PAD;
  const portsX = p.x + labelW + 6;
  const avail = Math.max(MIN_PORT_W, right - portsX);

  const portsW = Math.max(MIN_PORT_W, Math.min(avail * 0.42, 260));
  const rest = Math.max(0, avail - portsW - 12);
  const fanW = Math.max(0, Math.min(tall ? 96 : 56, rest * 0.35));
  const driveW = Math.max(0, Math.min(rest - fanW, tall ? 250 : 138));

  const fansX = portsX + portsW + 6;
  const drivesX = fansX + fanW + 6;

  const label = { x: p.x, y: p.y, w: labelW, h: p.h };
  const fans = { x: fansX, y: p.y + 4, w: fanW, h: Math.max(8, p.h - 8) };
  const drives = { x: drivesX, y: p.y + 5, w: driveW, h: Math.max(8, p.h - 10) };

  const canVent = p.h >= VENT_MIN_H;
  const portsY = p.y + (canVent ? 6 : 4);
  const portsH = Math.max(10, canVent ? p.h - 10 - VENT_H - 3 : p.h - 8);
  const ports = { x: portsX, y: portsY, w: portsW, h: portsH };

  const vents = canVent
    ? { x: portsX, y: ports.y + ports.h + 3, w: portsW, h: VENT_H }
    : null;

  return { label, ports, fans, drives, vents, tall };
}

export interface FanCircle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Fan bodies packed inside the `fans` zone, sized so every circle stays wholly
 * within it. Because the zone is horizontally disjoint from `ports`, a fan can
 * never reach a jack no matter how the radius is chosen — which is the property
 * the old free-floating `fanStart = driveAreaX - 78` could not offer.
 *
 * Returns [] when the zone is too narrow to hold a legible fan.
 */
export function fanCircles(zone: Rect, count: number): FanCircle[] {
  if (count <= 0 || zone.w < 12 || zone.h < 10) return [];
  const gap = 6;
  const perFan = (zone.w - (count - 1) * gap) / count;
  const r = Math.min(perFan / 2, zone.h / 2 - 1);
  if (r < 4) {
    // Not enough room for `count`; try fewer rather than drawing slivers.
    return count > 1 ? fanCircles(zone, count - 1) : [];
  }
  const totalW = count * r * 2 + (count - 1) * gap;
  const startX = zone.x + (zone.w - totalW) / 2 + r;
  const cy = zone.y + zone.h / 2;
  return Array.from({ length: count }, (_, i) => ({
    cx: startX + i * (r * 2 + gap),
    cy,
    r,
  }));
}

// ─── Network gear (switch / firewall / appliance) ────────────────────────────

/**
 * Zones for a network faceplate. Same contract as the server zones: `ports` is
 * reserved and every other element derives around it.
 */
export interface NetworkFaceZones {
  label: Rect;
  /** Slat block. */
  vents: Rect;
  /** RESERVED for ports. */
  ports: Rect;
  /** SFP/QSFP uplink cages, or null for kinds that have none. */
  cages: Rect | null;
  /** Console + management pair, or null. */
  aux: Rect | null;
}

/**
 * Network gear is port-dominated, so the brand margin stays modest: widening it
 * shrinks every jack. 96px fits ~13 characters, enough to read the family.
 */
const NET_LABEL_W = 96;
const NET_VENT_W = 26;
const NET_RIGHT_PAD = 7;
const AUX_W = 30;

/**
 * Switch / firewall: label → vents → ports → uplink cages.
 *
 * The cage zone is why this exists. Ports previously ran to `panel.w - 10` while
 * cages were drawn at `panel.w - cageW - 6`, so the last two columns of jacks sat
 * underneath the SFP cages on every switch — generic art and every switch skin.
 */
export function switchFaceZones(p: Rect): NetworkFaceZones {
  const labelW = clamp(p.w * 0.18, 48, NET_LABEL_W);
  const cageW = Math.min(44, p.w * 0.09);
  const cages = {
    x: p.x + p.w - cageW - NET_RIGHT_PAD,
    y: p.y + 4,
    w: cageW,
    h: Math.max(8, p.h - 8),
  };
  const label = { x: p.x, y: p.y, w: labelW, h: p.h };
  const vents = {
    x: label.x + label.w + 4,
    y: p.y + Math.max(4, p.h * 0.22),
    w: NET_VENT_W,
    h: Math.max(8, p.h * 0.5),
  };
  const portsX = vents.x + vents.w + 8;
  const ports = {
    x: portsX,
    y: p.y + 4,
    w: Math.max(MIN_PORT_W, cages.x - 8 - portsX),
    h: Math.max(10, p.h - 8),
  };
  return { label, vents, ports, cages, aux: null };
}

/**
 * Router / load-balancer / WLAN controller: label → console+mgmt → ports → vents.
 *
 * Vents sit on the RIGHT here (matching the vendor skins) rather than beside the
 * label, and no SFP cages — dense jack rows plus cages is the switch signature and
 * drawing it on an appliance misrepresents the hardware.
 */
export function applianceFaceZones(p: Rect): NetworkFaceZones {
  const labelW = clamp(p.w * 0.18, 48, NET_LABEL_W);
  const vents = {
    x: p.x + p.w - NET_VENT_W - NET_RIGHT_PAD,
    y: p.y + Math.max(4, p.h * 0.22),
    w: NET_VENT_W,
    h: Math.max(8, p.h * 0.5),
  };
  const label = { x: p.x, y: p.y, w: labelW, h: p.h };
  const aux = { x: label.x + label.w + 4, y: p.y + 4, w: AUX_W, h: Math.max(10, p.h - 8) };
  const portsX = aux.x + aux.w + 8;
  const ports = {
    x: portsX,
    y: p.y + 4,
    w: Math.max(MIN_PORT_W, vents.x - 8 - portsX),
    h: Math.max(10, p.h - 8),
  };
  return { label, vents, ports, cages: null, aux };
}

// ─── Power gear (rack UPS) ───────────────────────────────────────────────────

/**
 * Zones for a rack UPS faceplate: label → battery module → status LCD → outlets.
 *
 * `outlets` is the reserved band, exactly like `ports` elsewhere: the outlets are
 * real cablable ports now, so the battery block and LCD must derive AROUND them
 * rather than being placed by independent magic numbers. The APC skin previously
 * drew no outlets at all — just a vent block, which read as vents rather than as
 * something you could plug into.
 */
export interface UpsFaceZones {
  label: Rect;
  battery: Rect;
  lcd: Rect;
  /** RESERVED for outlets. */
  outlets: Rect;
}

export function upsFaceZones(p: Rect): UpsFaceZones {
  const labelW = clamp(p.w * 0.24, 56, 150);
  const outletsW = clamp(p.w * 0.40, 80, 300);
  const right = p.x + p.w - RIGHT_PAD;
  const outlets = { x: right - outletsW, y: p.y + 5, w: outletsW, h: Math.max(10, p.h - 10) };

  const midX = p.x + labelW + 6;
  const midW = Math.max(0, outlets.x - 8 - midX);
  // Battery takes the larger share of what is left; the LCD sits between it and the
  // outlets. Both collapse to zero width on a very narrow panel rather than overlap.
  const batteryW = midW * 0.62;
  const battery = { x: midX, y: p.y + 6, w: batteryW, h: Math.max(8, p.h - 12) };
  const lcdW = Math.max(0, midW - batteryW - 8);
  const lcd = { x: battery.x + batteryW + 8, y: p.y + 6, w: lcdW, h: Math.max(8, p.h - 12) };

  return { label: { x: p.x, y: p.y, w: labelW, h: p.h }, battery, lcd, outlets };
}

// ─── Patch panels ────────────────────────────────────────────────────────────
// Density lives in `model/panelDensity.ts` — it is a fact about hardware, not about
// drawing, and `model/validate.ts` needs it (model must never import from rack/).
export {
  PORTS_PER_PANEL_ROW,
  patchPanelRows,
  patchPanelRowCapacity,
  patchPanelOverCapacity,
} from '@/model/panelDensity';

// ─── Label room ──────────────────────────────────────────────────────────────

/**
 * Horizontal room the faceplate name may use, in px.
 *
 * The name used to be drawn from `panel.x + 8` with its length capped against the
 * WHOLE panel width, so on 1U gear it ran straight through the vents and the jack
 * rows — "Cisco Catalyst 9200" was struck through by its own ports. Real hardware
 * prints a small model marking in the left margin and stops; this returns that
 * margin so callers can truncate to it.
 *
 * `kind` is the PanelKind string rather than an import, keeping this module free of
 * a dependency cycle with panelKind.ts.
 */
export function labelRoom(kind: string, p: Rect): number {
  if (kind === 'server') return clamp(p.w * 0.26, 56, LABEL_W) - 10;
  if (kind === 'switch' || kind === 'firewall' || kind === 'appliance') {
    return clamp(p.w * 0.18, 48, NET_LABEL_W) - 10;
  }
  // A patch panel's jack row starts right after its brand margin, so the label gets
  // exactly that margin (PATCH_PORT_OPTS.nameZone) and no more.
  if (kind === 'patch') return 94;
  // A UPS label gets exactly its zone width, so the battery block / vents that
  // follow cannot clip the model name.
  if (kind === 'ups') return clamp(p.w * 0.24, 56, 150) - 10;
  // Fillers have no dense field crowding the label.
  return Math.max(40, Math.min(p.w * 0.3, 150));
}

/** Characters that fit in `room` px of monospace at `fontSize`. */
export function labelMaxChars(room: number, fontSize: number): number {
  return Math.max(3, Math.floor(room / (fontSize * 0.58)));
}

/** Truncate to `max` characters with an ellipsis, so a long model never bleeds. */
export function clampLabel(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}
