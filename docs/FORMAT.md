# The `.nexmap` file format

A `.nexmap` file is a single **UTF-8 JSON object** — the serialized NexMap
document. It is plain, diffable, and self-contained: there are no external
references, no binary blobs except inline data URIs, and nothing that requires a
server to interpret. You own these files; NexMap only ever reads and writes them
locally.

> Status: pre-1.0. The current shape is **schema v7** (`SCHEMA_VERSION` in
> [`src/model/schema.ts`](../src/model/schema.ts)). The format may still evolve,
> but the compatibility rules in this document are stable and enforced by tests
> (`src/model/migrate.ts`, `src/model/migrate.test.ts`, and
> `src/model/formatDoc.test.ts`, which loads the example below).

## Top-level shape

```jsonc
{
  "schemaVersion": 7,            // integer; gates migration and the too-new guard
  "appVersion": "0.6.2",         // the NexMap release that created the file; informational
  "project":  { "id", "name", "createdAt", "updatedAt", "description", "units" },
  "layers":   [ { "id", "name", "visible", "locked", "order" } ],
  "devices":  [ Device, ... ],   // each with `interfaces: [Interface, ...]`
  "links":    [ Link, ... ],     // logical links between devices
  "objects":  [ TextObject | ShapeObject | ImageObject, ... ],
  "vlans":    [ Vlan, ... ],
  "subnets":  [ Subnet, ... ],
  "racks":    [ Rack, ... ],
  "rackCables": [ RackCable, ... ], // physical patch cables, separate from links (v3)
  "views":    [ View, ... ],
  "invariants":  [ "rule-id", ... ],  // built-in rules the design declares (v6)
  "customRules": [ CustomRuleSpec, ... ], // authored role-based rules (v7)
  "enforcedRules": [ "rule-id", ... ], // optional: declared rules that are enforced
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
  fallbacks for imported endpoints.
- **Addresses live on interfaces as well as devices.** `Device.ip` is the
  management address; `Interface.ip` (v5) is a per-port address in CIDR form.
- **Rack cables are physical, links are logical.** A `RackCable` joins two
  mounted devices' ports; the patch planner relates the two.
- **Text objects carry ordered `blocks`** (v4), not flat `text`/`heading` fields.

## A complete v7 file

This file is loaded by a test on every run, so it stays valid:

```json
{
  "schemaVersion": 7,
  "appVersion": "0.6.2",
  "project": {
    "id": "proj-example",
    "name": "Two-device example",
    "createdAt": "2026-11-07T00:00:00.000Z",
    "updatedAt": "2026-11-07T00:00:00.000Z",
    "description": "",
    "units": "px"
  },
  "layers": [{ "id": "layer-default", "name": "Default", "visible": true, "locked": false, "order": 0 }],
  "devices": [
    {
      "id": "dev-edge",
      "kind": "device",
      "type": "router",
      "name": "edge-rtr",
      "x": 120,
      "y": 80,
      "width": 56,
      "height": 40,
      "layerId": "layer-default",
      "ip": "10.0.0.1",
      "interfaces": [{ "id": "if-edge-ge0", "name": "ge-0/0/0", "ip": "10.0.0.1/24" }]
    },
    {
      "id": "dev-core",
      "kind": "device",
      "type": "switch",
      "name": "core-sw",
      "x": 320,
      "y": 80,
      "width": 56,
      "height": 40,
      "layerId": "layer-default",
      "ip": "10.0.0.2",
      "interfaces": [{ "id": "if-core-1", "name": "Gi1/0/1" }]
    }
  ],
  "links": [
    {
      "id": "link-uplink",
      "kind": "link",
      "sourceId": "dev-edge",
      "targetId": "dev-core",
      "sourceIfaceId": "if-edge-ge0",
      "targetIfaceId": "if-core-1",
      "layerId": "layer-default"
    }
  ],
  "objects": [],
  "vlans": [],
  "subnets": [{ "id": "net-lan", "cidr": "10.0.0.0/24", "name": "LAN", "gateway": "10.0.0.1" }],
  "racks": [],
  "rackCables": [],
  "views": [],
  "invariants": [],
  "customRules": [],
  "interfaces": [],
  "assets": [],
  "customFields": []
}
```

## Schema history

| Version | Change | Kind |
| --- | --- | --- |
| v1 → v2 | first-class interfaces: every device gets `interfaces: []` | additive |
| v2 → v3 | Rack Designer: `racks`, `rackCables` | additive |
| v3 → v4 | rich callouts: text `text`/`heading`/`subheading` fold into `blocks` | rewrite |
| v4 → v5 | per-port addresses: `Interface.ip` | additive |
| v5 → v6 | declared rules: `invariants` | additive |
| v6 → v7 | authored role-based rules: `customRules` | additive |

Examples elsewhere in the docs or tests that show an older `schemaVersion` are
historical; NexMap still opens them by migrating forward.

## Compatibility rules (the contract)

These are guaranteed and tested:

1. **Forward-compatible by preservation.** Unknown fields are never dropped.
   Entities carry an `extra` bag, and the reserved top-level arrays
   (`interfaces`, `assets`, `customFields`) round-trip verbatim. A file written
   by a newer build that added a field will keep that field when an older build
   loads and re-saves it — *as long as the schema version still matches*.

2. **Older schema → migrate forward.** On load, a document below the current
   `schemaVersion` is migrated one version at a time through the registry in
   `migrate.ts`. Migrations keep every piece of content: most only add fields;
   v3→v4 rewrites a text object's flat fields into equivalent `blocks`.

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

## `appVersion`

New documents are stamped with the running release (`package.json` `version`,
injected at build time). The field records where a document originated: loading
never branches on it, and opening, migrating or re-saving a file keeps the value
it already has, including files created by other tools.

## Round-trip

`save` serializes the in-memory model to this JSON; `loadDocument` parses,
sanitizes, migrates, and validates it back. The pair is loss-preserving for
known fields and preservation-safe for unknown ones — the basis for trusting your
files across app versions.
