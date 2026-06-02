/**
 * Schema migration + safe load (eng review DA-D1, a data-safety hard requirement).
 *
 * Rules:
 *  - Older schema → migrate forward through the registry, one version at a time.
 *  - Newer schema than this app supports → REFUSE. Never load-and-resave, which
 *    would silently drop the newer fields and destroy the user's data.
 *  - Strip prototype-pollution keys (__proto__/constructor/prototype) from any
 *    parsed JSON before it touches the model (DA-S3).
 */
import { SCHEMA_VERSION } from './schema';
import type { NexMapDocument } from './types';

/** Each migration takes a doc at version N and returns a doc at version N+1. */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the FROM version. Add an entry whenever SCHEMA_VERSION increases. */
export const MIGRATIONS: Record<number, Migration> = {
  // 0: (doc) => ({ ...doc, schemaVersion: 1, newField: [] }),  // example
};

export type LoadResult =
  | { ok: true; doc: NexMapDocument }
  | { ok: false; reason: 'corrupt' | 'too-new' | 'invalid'; message: string };

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

  if (!isPlainObject(doc.project) || !Array.isArray(doc.devices) || !Array.isArray(doc.links)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Document is missing required project/devices/links.',
    };
  }

  return { ok: true, doc: doc as unknown as NexMapDocument };
}
