/**
 * Parts list → rack. Paste the gear list from a quote, a BOM or an email
 * ("2x Cisco Catalyst 9300-48P", "Dell R750", "24-port patch panel", "1U cable
 * manager") and get it mounted: each line becomes a quantity of a known vendor model
 * (rackCatalog) or a generic library preset (rackDevicePresets), and the plan stacks
 * it into the rack bottom-up, heaviest first — UPS at the bottom, then compute and
 * storage, then network gear, then switches and patching at the top of the stack.
 *
 * Pure: parse and plan here; the store mounts the plan as one undoable step. Lines it
 * can't recognise are reported, never guessed at. Local-first: nothing is looked up
 * online — only the built-in catalog and presets.
 */
import { RACK_CATALOG, type CatalogModel } from './rackCatalog';
import { RACK_DEVICE_PRESETS, presetByKey, presetSpan, type RackDevicePreset } from './rackDevicePresets';
import { canFit, isFullDepth, railChannel, slotOf, type Slot } from './rackModel';
import type { Device, DeviceType, Rack } from '@/model/types';

/** At most this many of one line (a stray "1000x" shouldn't fill a tab with devices). */
export const MAX_QTY = 100;

export interface PartsLine {
  /** 1-based line number in the pasted text. */
  line: number;
  raw: string;
  qty: number;
  /** What the line was recognised as — null when it wasn't. */
  preset: RackDevicePreset | null;
  /** The vendor model, when the line names one from the catalog. */
  catalog?: CatalogModel;
  /** U-height to mount at: the catalog's, else a "2U" written on the line, else the preset's. */
  span: number;
  /** "Cisco Catalyst 9300-48P" / "Patch panel (24)" — what the preview shows. */
  label: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Leading or trailing quantity: "2x", "2 x", "2 ×", "x2", "(2)", "qty 2", "2 -",
 * "2 pcs". Returns the quantity and the line without it.
 */
function splitQty(line: string): { qty: number; rest: string } {
  const patterns: RegExp[] = [
    /^\s*(?:qty[:\s]*)?(\d{1,4})\s*(?:x|×|pcs?\.?|units?|ea\.?)\s+(.+)$/i,
    /^\s*qty[:\s]*(\d{1,4})\s+(.+)$/i,
    /^\s*(\d{1,4})\s*[-:]\s+(.+)$/,
    /^\s*\((\d{1,4})\)\s*(.+)$/,
    // "2 Dell R750" — but not "24 port switch" / "2 U shelf" (that number describes the item).
    /^\s*(\d{1,3})\s+(?!(?:port|ports|u|ru|gb?|gbe|gige|tb)\b)([a-z].*)$/i,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) return { qty: Number(m[1]), rest: m[2]!.trim() };
  }
  // Trailing "x2" / "(2)" / "qty 2" — a space before it, so "MX204" isn't 204 of "M".
  const tail = line.match(/^(.+?)\s+(?:[x×]\s*(\d{1,4})|\((\d{1,4})\)|qty[:\s]*(\d{1,4}))\s*$/i);
  if (tail) return { qty: Number(tail[2] ?? tail[3] ?? tail[4]), rest: tail[1]!.trim() };
  return { qty: 1, rest: line.trim() };
}

/**
 * The catalog model a line names: every number-bearing token of its model must appear
 * ("9300" and "48p" for Catalyst 9300-48P). A model with no distinctive token (3+
 * digits) — "48-port Cat6 patch", "USW-Pro-48" — also needs its vendor named, or every
 * generic "24-port patch panel" would become a Panduit.
 */
/**
 * A model's number-bearing tokens. A letter-only suffix joined to a number by a hyphen
 * stays on it ("9800-L" → "9800l"), so a 9800-80 isn't taken for the 9800-L.
 */
function modelTokens(model: string): string[] {
  const out: string[] = [];
  for (const word of model.split(/\s+/)) {
    const segs = word.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const merged: string[] = [];
    for (const seg of segs) {
      const prev = merged[merged.length - 1];
      if (!/\d/.test(seg) && prev != null && /\d/.test(prev)) merged[merged.length - 1] = prev + seg;
      else merged.push(seg);
    }
    out.push(...merged.map(norm).filter((tok) => /\d/.test(tok) && tok.length >= 2));
  }
  return out;
}

function matchCatalog(text: string): CatalogModel | undefined {
  const t = norm(text);
  let best: { m: CatalogModel; score: number } | undefined;
  for (const m of RACK_CATALOG) {
    const tokens = modelTokens(m.model);
    if (tokens.length === 0 || !tokens.every((tok) => t.includes(tok))) continue;
    const distinctive = tokens.some((tok) => /\d{3}/.test(tok));
    if (!distinctive && !t.includes(norm(m.vendor))) continue;
    // Longer matched model tokens and a named vendor make a match more specific.
    const score = tokens.join('').length + (t.includes(norm(m.vendor)) ? 5 : 0);
    if (!best || score > best.score) best = { m, score };
  }
  return best?.m;
}

/** The generic preset closest to the model's type and size (for its ports and art). */
function presetForCatalog(m: CatalogModel): RackDevicePreset {
  const sameType = RACK_DEVICE_PRESETS.filter((p) => p.type === m.type && (p.mount ?? 'rack') === 'rack');
  const pick =
    sameType.find((p) => p.span === m.span && p.ports === m.ports) ??
    sameType.find((p) => p.span === m.span) ??
    sameType[0] ??
    presetByKey('server-1u')!;
  return pick;
}

/** A switch preset by port count: the smallest that has at least that many ports. */
function switchPreset(ports: number | null): RackDevicePreset {
  const sizes: [number, string][] = [[4, 'sw-4'], [8, 'sw-8'], [16, 'sw-16'], [24, 'sw-24'], [48, 'sw-48']];
  const key = ports == null ? 'sw-24' : (sizes.find(([n]) => n >= ports)?.[1] ?? 'sw-48');
  return presetByKey(key)!;
}

/** A generic preset from what the line says it is. Null when it doesn't say. */
function matchPreset(text: string): RackDevicePreset | null {
  const s = text.toLowerCase();
  const ports = Number(s.match(/(\d{1,3})\s*-?\s*(?:port|p\b)/)?.[1] ?? NaN);
  const n = Number.isFinite(ports) ? ports : null;
  const key = (k: string) => presetByKey(k)!;
  if (/patch/.test(s)) return /fib(er|re)|\blc\b|\bsc\b|\bmpo\b/.test(s) ? key('fiber') : key(n != null && n > 24 ? 'patch-48' : 'patch-24');
  if (/cable\s*(manager|mgr|mgmt|management|organi[sz]er)|wire\s*manager/.test(s)) {
    return /vertical|\b0\s*u\b/.test(s) ? key('vcm') : key('cable-mgr');
  }
  if (/blank(ing)?\s*(panel|plate)?|filler/.test(s)) return key('blank');
  if (/\bshelf\b|\bshelves\b/.test(s) && !/power|psu/.test(s)) return key('shelf');
  if (/\bpdu\b|power\s*(strip|distribution)/.test(s)) return key(/full[\s-]*height|vertical/.test(s) ? 'pdu-full' : 'pdu');
  if (/\bups\b|uninterruptible/.test(s)) return key('ups');
  if (/\bpsu\b|power\s*shelf/.test(s)) return key('psu');
  if (/console\s*server|terminal\s*server/.test(s)) return key('console');
  if (/firewall|\bfw\b|\bngfw\b|\butm\b/.test(s)) return key('firewall');
  if (/load\s*balancer|\badc\b/.test(s)) return key('lb');
  if (/wireless\s*(lan\s*)?controller|\bwlc\b/.test(s)) return key('wlc');
  if (/router|\bgateway\b/.test(s)) return key('router');
  if (/blade/.test(s)) return key('blade');
  if (/\bnas\b|\bsan\b|storage|disk\s*(shelf|array)/.test(s)) return key('storage');
  if (/core\s*switch|spine|10\s*g(be|bit)?\s*switch|\b(10|25|40|100)g\b.*switch/.test(s)) return key('sw-core');
  if (/switch/.test(s)) return switchPreset(n);
  if (/server|\bhost\b|hypervisor|compute\s*node/.test(s)) return key(/\b2\s*u\b|\(2u\)/.test(s) ? 'server-2u' : 'server-1u');
  return null;
}

/** "2U" / "(2U)" / "2 RU" written on the line, else null. */
function statedSpan(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\s*r?u\b/i);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 20 ? n : null;
}

/**
 * Read a pasted parts list. One line per item; blank lines, "#"/"//" comments and
 * header-ish lines ("Qty Description …") are skipped.
 */
export function parsePartsList(text: string): PartsLine[] {
  const out: PartsLine[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.replace(/^[\s*•\-–—]+/, '').trim(); // list bullets
    if (!raw || /^(#|\/\/)/.test(raw) || /^(qty|quantity|item|description|part)\b.*\b(description|model|part|qty)\b/i.test(raw)) return;
    // Tab/CSV rows: "2<TAB>Cisco C9300-48P" or "2,Cisco …" → treat the first cell as the quantity.
    const cells = raw.split(/\t|,(?=\s*[A-Za-z])/).map((c) => c.trim()).filter(Boolean);
    const joined = cells.length > 1 && /^\d{1,4}$/.test(cells[0]!) ? `${cells[0]}x ${cells.slice(1).join(' ')}` : raw;
    const { qty, rest } = splitQty(joined);
    const catalog = matchCatalog(rest);
    const preset = catalog ? presetForCatalog(catalog) : matchPreset(rest);
    const span = catalog?.span ?? (preset?.mount === 'rail' ? null : statedSpan(rest)) ?? preset?.span ?? 1;
    out.push({
      line: i + 1,
      raw,
      qty: Math.min(MAX_QTY, Math.max(1, qty)),
      preset,
      ...(catalog ? { catalog } : {}),
      span,
      label: catalog ? `${catalog.vendor} ${catalog.model}` : preset ? preset.label : rest,
    });
  });
  return out;
}

/** Bottom of the rack first: heavy power, then compute and storage, then network, then the patching layer. */
const STACK_ORDER: Partial<Record<DeviceType, number>> = {
  ups: 0,
  storage: 1,
  server: 2,
  router: 3,
  firewall: 3,
  'load-balancer': 3,
  'wireless-controller': 3,
  switch: 4,
  'patch-panel': 5,
  generic: 6,
};

export interface MountItem {
  /** The parsed line this unit came from. */
  line: PartsLine;
  /** Lowest U, or null when it doesn't fit in the rack (or, for a rail item, in any channel). */
  ru: number | null;
  mount: 'rack' | 'rail';
  side: 'front' | 'rear';
  /** Rack gear fills the bay; a rail item names its channel. */
  bay: 'full' | 'left' | 'right';
  /** U it takes here (a full-height vertical manager takes the rack's height). */
  span: number;
}

export interface MountPlan {
  items: MountItem[];
  placed: number;
  /** Units that found no room (same order as the list). */
  noRoom: MountItem[];
  /** Lines nothing matched (reported, not mounted). */
  unknown: PartsLine[];
}

/** A full-height vertical manager claims its rail before PDUs do; then bottom-up by type. */
const stackRank = (p: RackDevicePreset) => (p.fullHeight ? -1 : (STACK_ORDER[p.type] ?? 7));

/**
 * Where each unit of a parsed list would go in `rack` among its current `occupants`:
 * expanded by quantity, ordered heaviest-layer first, each into the lowest free U that
 * fits (so the stack builds upward). PDUs take the rear rail's right then left channel
 * (A and B feeds), then the front's; a vertical cable manager runs the front rail's full
 * height. A rail item only stacks under another in one channel once every channel is used.
 * Uses the rack designer's own fit rule, so a plan never contradicts placement.
 */
export function planMount(rack: Rack, occupants: readonly Device[], lines: readonly PartsLine[]): MountPlan {
  const unknown = lines.filter((l) => !l.preset);
  const units = lines
    .filter((l) => l.preset)
    .flatMap((l) => Array.from({ length: l.qty }, () => l))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => stackRank(a.l.preset!) - stackRank(b.l.preset!) || a.i - b.i)
    .map(({ l }) => l);

  // Ghost occupants for units already planned, so each fills the next free space.
  const taken: Device[] = [...occupants.filter((d) => d.rackId === rack.id)];
  const items: MountItem[] = [];
  const ghost = (ru: number, span: number, mount: 'rack' | 'rail', side: 'front' | 'rear', bay: MountItem['bay'], type: DeviceType, depthMm?: number): Device => ({
    id: `\u0000plan${items.length}`,
    kind: 'device',
    type,
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    layerId: '',
    rackId: rack.id,
    ru,
    ruSpan: span,
    mount,
    side,
    bay,
    ...(depthMm ? { depthMm } : {}),
  });
  for (const line of units) {
    const preset = line.preset!;
    if ((preset.mount ?? 'rack') === 'rail') {
      // A vertical manager dresses the front; PDUs feed from the rear. Channels go right
      // then left on the preferred face, then the other face; an empty channel beats
      // stacking under another item, so two PDUs become an A and a B feed.
      const span = presetSpan(preset, rack.ruHeight);
      const first: 'front' | 'rear' = preset.accessory === 'cable-manager' ? 'front' : 'rear';
      const other: 'front' | 'rear' = first === 'front' ? 'rear' : 'front';
      const channels = [first, other].flatMap((side) => (['right', 'left'] as const).map((bay) => ({ side, bay })));
      const lowest = (side: 'front' | 'rear', bay: 'left' | 'right') => {
        for (let u = 1; u <= rack.ruHeight - span + 1; u++) {
          const slot: Slot = { ru: u, ruSpan: span, mount: 'rail', side, bay, depth: 'shallow' };
          if (canFit(rack, taken, slot).ok) return u;
        }
        return null;
      };
      const empty = (side: 'front' | 'rear', bay: 'left' | 'right') =>
        !taken.some((d) => d.mount === 'rail' && slotOf(d).side === side && railChannel(slotOf(d)) === bay);
      let spot: { ru: number; side: 'front' | 'rear'; bay: 'left' | 'right' } | null = null;
      for (const pass of [true, false]) {
        for (const c of channels) {
          if (pass && !empty(c.side, c.bay)) continue;
          const ru = lowest(c.side, c.bay);
          if (ru != null) {
            spot = { ru, ...c };
            break;
          }
        }
        if (spot) break;
      }
      items.push({ line, ru: spot?.ru ?? null, mount: 'rail', side: spot?.side ?? first, bay: spot?.bay ?? 'right', span });
      if (spot) taken.push(ghost(spot.ru, span, 'rail', spot.side, spot.bay, preset.type));
      continue;
    }
    const depth = isFullDepth(preset.type) ? 'full' : 'shallow';
    // A catalog model's real depth lets a short unit share a U with rear gear.
    const depthMm = line.catalog?.depthMm;
    let ru: number | null = null;
    for (let u = 1; u <= rack.ruHeight - line.span + 1; u++) {
      const slot: Slot = { ru: u, ruSpan: line.span, mount: 'rack', side: 'front', bay: 'full', depth, ...(depthMm ? { depthMm } : {}) };
      if (canFit(rack, taken, slot).ok) {
        ru = u;
        break;
      }
    }
    items.push({ line, ru, mount: 'rack', side: 'front', bay: 'full', span: line.span });
    if (ru != null) taken.push(ghost(ru, line.span, 'rack', 'front', 'full', preset.type, depthMm));
  }
  const noRoom = items.filter((it) => it.ru == null);
  return { items, placed: items.length - noRoom.length, noRoom, unknown };
}
