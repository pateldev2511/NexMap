# The `.nexmap` file format

A `.nexmap` file is a single **UTF-8 JSON object** — the serialized NexMap
document. It is plain, diffable, and self-contained: there are no external
references, no binary blobs except inline data URIs, and nothing that requires a
server to interpret. You own these files; NexMap only ever reads and writes them
locally.

> Status: pre-1.0. The shape below is **schema v2**. The format may still evolve,
> but the compatibility rules in this document are stable and enforced by tests
> (`src/model/migrate.ts`, `src/model/migrate.test.ts`).

## Top-level shape

```jsonc
{
  "schemaVersion": 2,            // integer; gates migration and the too-new guard
  "appVersion": "0.1.0",         // informational
  "project":  { "id", "name", "createdAt", "updatedAt", "description", "units" },
  "layers":   [ { "id", "name", "visible", "locked", "order" } ],
  "devices":  [ Device, ... ],
  "links":    [ Link, ... ],
  "objects":  [ TextObject | ShapeObject | ImageObject, ... ],
  "vlans":    [ Vlan, ... ],
  "subnets":  [ Subnet, ... ],
  "racks":    [ Rack, ... ],
  "views":    [ View, ... ],
  "interfaces":   [],            // reserved, preserved verbatim
  "assets":       [],            // reserved, preserved verbatim
  "customFields": []             // reserved, preserved verbatim
}
```

The authoritative TypeScript types live in
[`src/model/types.ts`](../src/model/types.ts). A few load-bearing invariants:

- **Every object has a stable string `id`.** IDs are referenced, never names —
  renaming a device never breaks a link.
- **Links reference device IDs** (`sourceId` / `targetId`), with optional
  first-class interface refs (`sourceIfaceId` / `targetIfaceId`) and free-text
  endpoint labels kept in sync.
- **Coordinates are canvas pixels** (`units: "px"`). The flat model is canonical;
  the isometric view is a render-time projection, not stored geometry.

## Compatibility rules (the contract)

These are guaranteed and tested:

1. **Forward-compatible by preservation.** Unknown fields are never dropped.
   Entities carry an `extra` bag, and the reserved top-level arrays
   (`interfaces`, `assets`, `customFields`) round-trip verbatim. A file written
   by a newer build that added a field will keep that field when an older build
   loads and re-saves it — *as long as the schema version still matches*.

2. **Older schema → migrate forward.** On load, a document below the current
   `schemaVersion` is migrated one version at a time through the registry in
   `migrate.ts`. Migrations are additive (e.g. v1→v2 gave every device an empty
   `interfaces` array); they never drop data.

3. **Newer schema → refuse, never downgrade.** If `schemaVersion` is higher than
   the running app supports, the load is **rejected** rather than silently
   re-saved — re-saving would drop the newer fields and destroy data.

4. **Hostile input is neutralized.** Prototype-pollution keys
   (`__proto__`, `constructor`, `prototype`) are stripped recursively before the
   JSON touches the model. Rich-text descriptions and SVG image underlays are
   sanitized with DOMPurify on load and on render.

5. **Loading never throws.** `loadDocument(raw)` returns a discriminated result
   (`ok` / `corrupt` / `too-new` / `invalid`) so the UI can explain failures
   instead of crashing.

## Round-trip

`save` serializes the in-memory model to this JSON; `loadDocument` parses,
sanitizes, migrates, and validates it back. The pair is loss-preserving for
known fields and preservation-safe for unknown ones — the basis for trusting your
files across app versions.
