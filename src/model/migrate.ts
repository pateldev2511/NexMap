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
import { SCHEMA_VERSION } from './schema';
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
  | { ok: true; doc: NexMapDocument; migratedFrom?: number }
  | {
      ok: false;
      reason: 'corrupt' | 'too-new' | 'invalid';
      message: string;
      /** For a structural refusal: the offending field, e.g. `devices[3].id`. */
      path?: string;
    };

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Recursively strip prototype-pollution keys from parsed JSON. */
export function stripDangerousKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripDangerousKeys(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = stripDangerousKeys(v);
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
 * older schema too). Pure and total, like loadDocument.
 */
export function migrateDocument(parsed: unknown): LoadResult {
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

  return {
    ok: true,
    doc: doc as unknown as NexMapDocument,
    ...(startVersion < SCHEMA_VERSION ? { migratedFrom: startVersion } : {}),
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
