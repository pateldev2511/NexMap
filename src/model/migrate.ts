/**
 * Schema migration + safe load (eng review DA-D1, a data-safety hard requirement).
 *
 * Rules:
 *  - Older schema → migrate forward through the registry, one version at a time.
 *  - Newer schema than this app supports → REFUSE. Never load-and-resave, which
 *    would silently drop the newer fields and destroy the user's data.
 *  - Strip prototype-pollution keys (__proto__/constructor/prototype) from any
 *    parsed JSON before it touches the model (DA-S3).
 *  - After migration, validate the structure the editor indexes (required lists,
 *    entry shapes, unique ids) before the document is adopted (#26).
 */
import { legacyToBlocks } from './callout';
import {
  isRemoteHref,
  isSafeColor,
  isSafeImageHref,
  MAX_COORD,
  MAX_RACK_UNITS,
  SCHEMA_VERSION,
} from './schema';

export { MAX_RACK_UNITS };
import type { NexMapDocument } from './types';

/** Each migration takes a doc at version N and returns a doc at version N+1. */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the FROM version. Add an entry whenever SCHEMA_VERSION increases. */
export const MIGRATIONS: Record<number, Migration> = {
  // 0: (doc) => ({ ...doc, schemaVersion: 1, newField: [] }),  // example
  //
  // v1 → v2: first-class interfaces. Purely ADDITIVE — give every device an empty
  // `interfaces` array (preserving any that already exist). No data is dropped, so this
  // is a safe forward-only step; the version stamp + the too-new guard keep older builds
  // from silently re-saving and losing the new field.
  1: (doc) => ({
    ...doc,
    schemaVersion: 2,
    devices: (Array.isArray(doc.devices) ? doc.devices : []).map((d) =>
      typeof d === 'object' && d !== null
        ? { interfaces: [], ...(d as Record<string, unknown>) }
        : d,
    ),
  }),
  // v2 → v3: rack designer. Purely ADDITIVE.
  //  - Add the `rackCables` collection (empty).
  //  - Give racked devices the default slot qualifiers (mount/side/bay). `ru`/`ruSpan`
  //    stay CANONICAL for vertical position; these only add the front face + full bay,
  //    so existing v2 racked devices keep their exact U positions.
  // Older builds refuse a v3 file (too-new guard) rather than re-save and drop rackCables.
  2: (doc) => ({
    ...doc,
    schemaVersion: 3,
    rackCables: Array.isArray(doc.rackCables) ? doc.rackCables : [],
    devices: (Array.isArray(doc.devices) ? doc.devices : []).map((d) => {
      if (typeof d !== 'object' || d === null) return d;
      const dev = d as Record<string, unknown>;
      // Only racked devices get slot qualifiers; free-canvas devices are untouched.
      if (dev.rackId == null) return dev;
      return { mount: 'rack', side: 'front', bay: 'full', ...dev };
    }),
  }),
  // v3 → v4: rich callouts. DESTRUCTIVE for text objects — the flat
  // `text`/`heading`/`subheading` fields are folded into an ordered `blocks`
  // array and removed. Non-text objects are untouched. Older builds refuse a v4
  // file (too-new guard) rather than re-save and drop `blocks`.
  3: (doc) => ({
    ...doc,
    schemaVersion: 4,
    objects: (Array.isArray(doc.objects) ? doc.objects : []).map((o) => {
      if (typeof o !== 'object' || o === null) return o;
      const obj = o as Record<string, unknown>;
      if (obj.kind !== 'text') return obj;
      // Already migrated (defensive against double-apply / hand-authored v4 shapes).
      if (Array.isArray(obj.blocks)) {
        const { text: _t, heading: _h, subheading: _s, ...rest } = obj;
        return rest;
      }
      const str = (v: unknown): string | undefined =>
        typeof v === 'string' && v.length > 0 ? v : undefined;
      const { text: _t, heading: _h, subheading: _s, ...rest } = obj;
      return {
        ...rest,
        blocks: legacyToBlocks(str(obj.heading), str(obj.subheading), str(obj.text)),
      };
    }),
  }),
  // v4 → v5: per-port IP addresses. Purely ADDITIVE — `Interface.ip` is a new
  // optional field (absent = unaddressed), so nothing on disk changes beyond the
  // version stamp. Older builds refuse a v5 file (too-new guard) rather than
  // re-save and silently drop port IPs.
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
  // v5 → v6: declarative invariants. Purely ADDITIVE — add the `invariants` list
  // of declared rule ids (empty: a pre-v6 design declared none). Older builds
  // refuse a v6 file (too-new guard) rather than re-save and drop the rules.
  5: (doc) => ({ ...doc, schemaVersion: 6, invariants: [] }),
  // v6 → v7: authored role-based rules. Purely ADDITIVE — add the `customRules`
  // list (empty: a pre-v7 design authored none). Older builds refuse a v7 file.
  6: (doc) => ({ ...doc, schemaVersion: 7, customRules: [] }),
};

export type LoadResult =
  | {
      ok: true;
      doc: NexMapDocument;
      migratedFrom?: number;
      /**
       * What the load had to repair to make the file safe to open and export, as
       * plain-language phrases ("1 rack height was limited to 1000U"). Absent when
       * nothing was. Show them with loadRepairSummary() — a repair the user is not
       * told about becomes permanent at the next autosave.
       */
      warnings?: string[];
      /** How many individual values the warnings cover. */
      repairs?: number;
    }
  | {
      ok: false;
      reason: 'corrupt' | 'too-new' | 'invalid';
      message: string;
      /** For a structural refusal: the offending field, e.g. `devices[3].id`. */
      path?: string;
    };

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deepest nesting a document may have. Real documents are ~10 deep; the cap turns
 * a crafted 200k-deep array into a clean refusal instead of a stack overflow.
 */
export const MAX_JSON_DEPTH = 256;

/**
 * Recursively strip prototype-pollution keys from parsed JSON (returns a deep
 * copy). THROWS on input nested deeper than MAX_JSON_DEPTH — callers that
 * promise not to throw (migrateDocument, the importers) catch it and refuse.
 */
export function stripDangerousKeys<T>(value: T, depth = 0): T {
  if (depth > MAX_JSON_DEPTH) throw new RangeError('Document is nested too deeply.');
  if (Array.isArray(value)) {
    return value.map((v) => stripDangerousKeys(v, depth + 1)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = stripDangerousKeys(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse and migrate a `.nexmap` JSON string into a current-version document.
 * Pure and total — never throws; returns a discriminated result.
 */
export function loadDocument(raw: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt', message: 'File is not valid JSON.' };
  }
  return migrateDocument(parsed);
}

/**
 * Migrate and validate an already-parsed document (a file's JSON, or an autosave
 * draft read back from IndexedDB — a draft written by an older build is at an
 * older schema too). Pure and total, like loadDocument: ANY throw underneath — a
 * migration step tripping on malformed data, a document nested deeply enough to
 * overflow the stack — becomes a `corrupt` refusal, never an exception (#72).
 */
export function migrateDocument(parsed: unknown): LoadResult {
  try {
    return migrateUnsafe(parsed);
  } catch {
    return {
      ok: false,
      reason: 'corrupt',
      message: 'This file is damaged and could not be read.',
    };
  }
}

function migrateUnsafe(parsed: unknown): LoadResult {
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'invalid', message: 'Document root is not an object.' };
  }

  let doc = stripDangerousKeys(parsed);

  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Missing or invalid schemaVersion.',
    };
  }

  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'too-new',
      message:
        `This file uses schema v${version}, but this app supports up to ` +
        `v${SCHEMA_VERSION}. Update NexMap to open it. Opening read-only would ` +
        `risk dropping newer data on save, so we won't.`,
    };
  }

  // Migrate forward one version at a time.
  const startVersion = version;
  let v = version;
  while (v < SCHEMA_VERSION) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      return {
        ok: false,
        reason: 'invalid',
        message: `No migration path from schema v${v} to v${v + 1}.`,
      };
    }
    doc = migration(doc);
    v += 1;
  }

  if (
    !isPlainObject(doc.project) ||
    !Array.isArray(doc.devices) ||
    !Array.isArray(doc.links)
  ) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Document is missing required project/devices/links.',
    };
  }

  // Structure the editor relies on, checked BEFORE anything is adopted: a refusal
  // here leaves the open project, its history and its file untouched.
  const problem = structuralProblem(doc);
  if (problem) {
    return {
      ok: false,
      reason: 'invalid',
      message: `This file can't be opened: ${problem.path} ${problem.issue}.`,
      path: problem.path,
    };
  }

  // `doc` is our own deep copy (stripDangerousKeys), so repairing in place is safe.
  const { warnings, repairs } = sanitizeDocumentCounted(doc);

  return {
    ok: true,
    doc: doc as unknown as NexMapDocument,
    ...(startVersion < SCHEMA_VERSION ? { migratedFrom: startVersion } : {}),
    ...(warnings.length > 0 ? { warnings, repairs } : {}),
  };
}

type FieldCheck = 'string' | 'number' | 'object';

/**
 * What each indexed collection's entries must carry: only the fields the editor
 * dereferences without a guard. Everything else (optional props, unknown future
 * fields) passes through untouched, so forward-compatible files still open.
 */
const ENTRY_SHAPES: Record<string, Record<string, FieldCheck>> = {
  layers: { id: 'string' },
  devices: {
    id: 'string',
    type: 'string',
    name: 'string',
    x: 'number',
    y: 'number',
    width: 'number',
    height: 'number',
  },
  links: { id: 'string', sourceId: 'string', targetId: 'string' },
  objects: { id: 'string', x: 'number', y: 'number', width: 'number', height: 'number' },
  vlans: { id: 'string', vlanId: 'number' },
  subnets: { id: 'string', cidr: 'string' },
  racks: { id: 'string', ruHeight: 'number' },
  rackCables: { id: 'string', aEnd: 'object', bEnd: 'object' },
  views: { id: 'string' },
};

/** Collections that must be present. The rest may be absent (read as empty). */
const REQUIRED = new Set(['layers', 'devices', 'links']);

const EXPECTED: Record<FieldCheck, string> = {
  string: 'a string',
  number: 'a finite number',
  object: 'an object',
};

function fieldOk(v: unknown, check: FieldCheck): boolean {
  if (check === 'string') return typeof v === 'string';
  if (check === 'number') return typeof v === 'number' && Number.isFinite(v);
  return isPlainObject(v);
}

/** The first structural problem in a migrated doc, as a field path + what's wrong. */
export function structuralProblem(
  doc: Record<string, unknown>,
): { path: string; issue: string } | null {
  const project = doc.project as Record<string, unknown>;
  if (typeof project.id !== 'string' || project.id === '') {
    return { path: 'project.id', issue: 'must be a non-empty string' };
  }
  if (typeof project.name !== 'string') {
    return { path: 'project.name', issue: 'must be a string' };
  }

  for (const [collection, shape] of Object.entries(ENTRY_SHAPES)) {
    const list = doc[collection];
    if (list === undefined && !REQUIRED.has(collection)) continue;
    if (!Array.isArray(list)) {
      return {
        path: collection,
        issue: list === undefined ? 'is missing (expected a list)' : 'must be a list',
      };
    }
    // Ids are the editor's keys: a repeat would silently keep only the last entry,
    // and the next save would drop the others.
    const seen = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      const entry: unknown = list[i];
      const at = `${collection}[${i}]`;
      if (!isPlainObject(entry)) return { path: at, issue: 'must be an object' };
      for (const [field, check] of Object.entries(shape)) {
        if (!fieldOk(entry[field], check)) {
          return { path: `${at}.${field}`, issue: `must be ${EXPECTED[check]}` };
        }
      }
      const id = entry.id as string;
      if (id === '') return { path: `${at}.id`, issue: 'must not be empty' };
      if (collection === 'objects' && entry.kind === 'text' && !Array.isArray(entry.blocks)) {
        return { path: `${at}.blocks`, issue: 'must be a list (the callout text)' };
      }
      if (collection === 'racks' && (entry.ruHeight as number) < 1) {
        return { path: `${at}.ruHeight`, issue: 'must be at least 1' };
      }
      const first = seen.get(id);
      if (first !== undefined) {
        return {
          path: `${at}.id`,
          issue: `repeats the id "${id}" already used by ${collection}[${first}]`,
        };
      }
      seen.set(id, i);
    }
  }
  return null;
}

/* ── Value sanitising ─────────────────────────────────────────────────────────
 * structuralProblem() REFUSES only what the editor cannot index (a missing id, a
 * non-finite coordinate). Everything else is REPAIRED here, and the user is told:
 * a file the app's own UI could have produced must always open. Repairs cover
 * what would hurt later — every numeric field an export interpolates must be a
 * finite number (a string there could break out of an SVG attribute), colours
 * must be plain paints (no `url(...)`), an image may only be embedded (a remote
 * one would make the export phone home), and absurd geometry is limited.
 */

type Range = readonly [min: number, max: number];
const ANY: Range = [-Number.MAX_VALUE, Number.MAX_VALUE];

/**
 * Optional numeric fields, by collection. ANY = "finite" only: the Inspector's
 * own inputs put no bounds on these (font size, U position, U height…), so the
 * loader must not either. The few ranges are wider than what the UI can make.
 */
const NUMERIC_FIELDS: Record<string, Record<string, Range>> = {
  layers: { order: ANY },
  devices: {
    iconScale: ANY,
    labelHeight: ANY,
    ru: ANY,
    ruSpan: ANY,
    watts: ANY,
    weightKg: ANY,
    depthMm: ANY,
    priceUsd: ANY,
    ratedAmps: ANY,
    ratedVolts: ANY,
    ratedPhases: ANY,
    ratedWatts: ANY,
    z: ANY,
  },
  links: { width: ANY },
  objects: { z: ANY, opacity: [0, 1], fontSize: ANY },
  racks: { maxWatts: ANY, maxWeightKg: ANY, depthMm: ANY, order: ANY },
  rackCables: { lengthFt: ANY },
};

/** Optional text fields that reach an export and must be strings. */
const STRING_FIELDS: Record<string, readonly string[]> = {
  objects: ['label'],
  rackCables: ['label'],
};

/** Colour fields, by collection → the value a bad one is repaired to (undefined = remove). */
const COLOR_FIELDS: Record<string, Record<string, string | undefined>> = {
  devices: { fill: undefined },
  links: { color: undefined },
  objects: { color: undefined, fill: undefined, stroke: undefined },
  vlans: { color: undefined },
  rackCables: { color: '#64748b' },
};

/** A finite number from a number or a numeric string; otherwise undefined. */
function toFinite(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Make `entry[field]` a finite number in range. Absent/null stays as it is; a
 * numeric string is converted; anything else is removed (the field's default
 * applies). Returns whether it changed.
 */
function fixNumber(entry: Record<string, unknown>, field: string, [min, max]: Range): boolean {
  const v = entry[field];
  if (v === undefined || v === null) return false;
  const n = toFinite(v);
  if (n === undefined) {
    delete entry[field];
    return true;
  }
  const clamped = Math.min(max, Math.max(min, n));
  if (clamped === v) return false;
  entry[field] = clamped;
  return true;
}

function finitePoint(p: unknown): p is { x: number; y: number } {
  return (
    isPlainObject(p) &&
    typeof p.x === 'number' &&
    typeof p.y === 'number' &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y)
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Repair a structurally valid document in place; returns plain-language phrases
 * describing what was changed (empty when the file was clean).
 */
export function sanitizeDocument(doc: Record<string, unknown>): string[] {
  return sanitizeDocumentCounted(doc).warnings;
}

function sanitizeDocumentCounted(doc: Record<string, unknown>): {
  warnings: string[];
  repairs: number;
} {
  let remoteImages = 0;
  let badImages = 0;
  let rackHeights = 0;
  let geometry = 0;
  let colors = 0;
  let values = 0;
  const list = (name: string) =>
    Array.isArray(doc[name]) ? (doc[name] as Record<string, unknown>[]) : [];

  // Images: only an embedded source may stay; otherwise the whole object goes.
  if (Array.isArray(doc.objects)) {
    const kept = list('objects').filter((o) => {
      if (o.kind !== 'image' || isSafeImageHref(o.href)) return true;
      if (isRemoteHref(o.href)) remoteImages++;
      else badImages++;
      return false;
    });
    if (kept.length !== doc.objects.length) doc.objects = kept;
  }

  // Rack heights: whole-file refusal would lock the user out of their own work.
  for (const r of list('racks')) {
    if ((r.ruHeight as number) > MAX_RACK_UNITS) {
      r.ruHeight = MAX_RACK_UNITS;
      rackHeights++;
    }
  }

  // Geometry: finite (checked structurally) but absurd boxes are limited (#78).
  for (const name of ['devices', 'objects']) {
    for (const e of list(name)) {
      // Magnitude only: a negative size is odd but harmless, and the Inspector can make one.
      for (const f of ['x', 'y', 'width', 'height']) {
        if (fixNumber(e, f, [-MAX_COORD, MAX_COORD])) geometry++;
      }
    }
  }

  for (const [collection, fields] of Object.entries(NUMERIC_FIELDS)) {
    for (const entry of list(collection)) {
      for (const [field, range] of Object.entries(fields)) {
        if (fixNumber(entry, field, range)) values++;
      }
    }
  }
  for (const [collection, fields] of Object.entries(STRING_FIELDS)) {
    for (const entry of list(collection)) {
      for (const field of fields) {
        if (entry[field] !== undefined && typeof entry[field] !== 'string') {
          delete entry[field];
          values++;
        }
      }
    }
  }
  for (const [collection, fields] of Object.entries(COLOR_FIELDS)) {
    for (const entry of list(collection)) {
      for (const [field, fallback] of Object.entries(fields)) {
        const v = entry[field];
        if (v === undefined && fallback === undefined) continue;
        if (isSafeColor(v)) continue;
        if (fallback === undefined) delete entry[field];
        else entry[field] = fallback;
        colors++;
      }
    }
  }

  for (const d of list('devices')) {
    if (d.interfaces === undefined) continue;
    if (!Array.isArray(d.interfaces)) {
      delete d.interfaces;
      values++;
      continue;
    }
    for (const iface of d.interfaces) {
      if (isPlainObject(iface) && fixNumber(iface, 'vlan', ANY)) values++;
    }
  }

  for (const l of list('links')) {
    if (l.waypoints === undefined) continue;
    if (!Array.isArray(l.waypoints)) {
      delete l.waypoints;
      values++;
      continue;
    }
    const pts = l.waypoints.filter(finitePoint);
    if (pts.length !== l.waypoints.length) {
      l.waypoints = pts;
      values++;
    }
    for (const p of pts as Record<string, unknown>[]) {
      for (const f of ['x', 'y']) if (fixNumber(p, f, [-MAX_COORD, MAX_COORD])) geometry++;
    }
  }

  for (const o of list('objects')) {
    if (o.kind !== 'text') continue;
    if (o.leader !== undefined) {
      const leader = o.leader;
      const ok =
        isPlainObject(leader) &&
        typeof leader.dash === 'string' &&
        toFinite(leader.width) !== undefined;
      if (!ok) {
        delete o.leader;
        values++;
      } else {
        if (fixNumber(leader, 'width', ANY)) values++;
        if (!isSafeColor(leader.color)) {
          leader.color = '#2563eb';
          colors++;
        }
      }
    }
    const anchor = o.anchor;
    if (anchor !== undefined && anchor !== null) {
      const ok =
        isPlainObject(anchor) &&
        ((anchor.type === 'device' && typeof anchor.id === 'string') ||
          (anchor.type === 'point' && finitePoint(anchor)));
      if (!ok) {
        o.anchor = null;
        values++;
      }
    }
  }

  const warnings: string[] = [];
  const say = (n: number, one: string, many: string, was: string, were = was) => {
    if (n > 0) warnings.push(`${plural(n, one, many)} ${n === 1 ? was : were}`);
  };
  say(remoteImages, 'image', 'images', 'linked to an outside address was removed', 'linked to an outside address were removed');
  say(badImages, 'image', 'images', 'that was not stored in the file was removed', 'that were not stored in the file were removed');
  say(rackHeights, 'rack height', 'rack heights', `was limited to ${MAX_RACK_UNITS}U`, `were limited to ${MAX_RACK_UNITS}U`);
  say(geometry, 'position or size', 'positions or sizes', 'was out of range and was limited', 'were out of range and were limited');
  say(colors, 'colour', 'colours', 'could not be used and was reset', 'could not be used and were reset');
  say(values, 'setting', 'settings', 'could not be read and was reset', 'could not be read and were reset');
  return {
    warnings,
    repairs: remoteImages + badImages + rackHeights + geometry + colors + values,
  };
}

/**
 * One plain sentence for the notice shown after a load that repaired something:
 * "Opened with 2 repairs: 1 image linked to an outside address was removed;
 * 1 rack height was limited to 1000U." Null when nothing was repaired.
 */
export function loadRepairSummary(
  result: { warnings?: string[]; repairs?: number },
  verb = 'Opened',
): string | null {
  const warnings = result.warnings ?? [];
  if (warnings.length === 0) return null;
  const n = result.repairs ?? warnings.length;
  const MAX = 3;
  const shown = warnings.slice(0, MAX);
  if (warnings.length > MAX) shown.push(`and ${warnings.length - MAX} more kinds of repair`);
  return `${verb} with ${plural(n, 'repair', 'repairs')}: ${shown.join('; ')}.`;
}
