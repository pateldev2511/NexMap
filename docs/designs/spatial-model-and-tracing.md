---
status: DRAFT
---
# CEO Plan: Spatial Model, Cable Tracing & Unified Rack Canvas
Authored 2026-08-08 (user brief + Patchbox video teardown)
Branch: main | Mode: SELECTIVE EXPANSION
Repo: pateldev2511/NexMap
Pinned to: commit `ca97d97` (clean tree apart from a benign `package-lock.json`
version-field correction). **Every line ref below was verified against this
commit on 2026-08-08** — but per the standing caveat in
`pointer-native-canvas.md`, re-verify at implementation time rather than
trusting them as fact.

## Problem (user brief, 2026-08-08)

> "Review the whole Project and its goal. Think as an Experienced Engineer and
> Lazy User… take Inspirations where need from the Patch docs for Rack Designer
> and FossFLOW for Network Designer. Optimize our app, Extend its use cases,
> think what else can we replace… make user experience better and app more
> intelligent and easy to use and navigate. Be very careful… consider all edge
> cases and don't assume anything."

Reference material: a 37s screen recording of **Patchbox** (`PATCHBOX GmbH`,
`mike@patchbox.com`) — 18 frames extracted at 2s intervals and read directly.
Not a public doc set; the teardown below is from the frames only.

## Audit evidence driving this plan (verified 2026-08-08 at `ca97d97`)

Facts established by reading code, not inferred:

1. **`SCHEMA_VERSION` is already 4**, not 3 ([schema.ts:27](../../src/model/schema.ts:27)).
   `types.ts` comments say "schema v3" for `RackCable`/slot qualifiers because
   callouts bumped v3→v4 afterwards ([migrate.ts:57](../../src/model/migrate.ts:57)).
   **This plan therefore targets v5.** Anyone reading the type comments alone
   would have got this wrong.
2. **First-class interfaces already shipped.** `Interface` is a real type with
   `name`/`kind`/`speed`/`vlan` ([types.ts:63](../../src/model/types.ts:63)),
   `Device.interfaces[]` landed in v2, and `Link.sourceIfaceId`/`targetIfaceId`
   exist. → **[README.md:100](../../README.md:100) is factually stale**: it
   claims "First-class interfaces/ports are not modeled yet". Fix in W1.
3. **No location hierarchy of any kind.** `grep` for
   `building|floor|room|siteId|parentId|locationId` across `model/types.ts`
   returns **zero hits**. `Rack.site?: string` ([types.ts:368](../../src/model/types.ts:368))
   is the only spatial field and it is unstructured free text.
4. **No cable tracing, and no port selection.** `cablePath.ts` is *purely SVG
   curve math* (bowed Bézier control points) — despite the name it contains no
   topology. `grep` for `selectedPort|activePort|portSelect` across
   `src/rack/*.tsx` and `src/store/*.ts` returns **zero hits**.
5. **Physical and logical layers are deliberately disjoint.** `RackCable` lives
   in its own `rackCables[]` collection precisely "so the physical layer never
   pollutes the logical topology" ([types.ts:394](../../src/model/types.ts:394)).
   Nothing reconciles the two.
6. **Faceplate art is already parametric off interfaces** — "the actual
   jack/bay counts come from the device's interfaces, not from per-model
   artwork" (`panelKind.ts` header). This is the foundation port-level work
   needs, and it already exists.
7. **A shared gesture core already exists**: `src/input/` (machine.ts, wheel.ts,
   router.ts) with `fuzz.test.ts` + `machine.test.ts`. A unified rack canvas
   consumes this — it must **not** become a 4th gesture implementation.
8. **The rack designer already carries the drill-in** it needs to lose:
   `const [view, setView] = useState<'focus' | 'row'>('row')`
   ([RackDesigner.tsx:158](../../src/rack/RackDesigner.tsx:158)), one of ~20
   `useState` hooks in that component.
9. Baseline is green at this commit: 757 tests / 77 files pass, `tsc -b
   --noEmit` clean, `vite build` succeeds.

### What Patchbox actually does better (from the frames)

| Capability | Patchbox | NexMap at `ca97d97` |
| --- | --- | --- |
| Fully-qualified addressing | `HQ/28/SL/RK001_M/A/05` + breadcrumb `PBX › Locations › HQ › 28 › RK001_M` | none — free-text `Rack.site` |
| Multi-hop cable trace | port inspector lists every hop, direction-coded arrows | none |
| Port as selectable object | Rack / Device / **Port** inspector scopes | port editing trapped in a drill-in dialog |
| Focus by dimming | selecting anything greys out all other gear | none |
| Rack asset record | responsible person, manufacturer, model, serial, purchase date, operation start, photos | partial — asset fields are on `Device`, not `Rack` |

### What NexMap already does better (do not regress)

Power/weight budgets (`rackBudget`), airflow (`rackAirflow`), BOM + cost
(`rackBom`), health scoring (`rackHealth`, `rackHealthScore`), actionable
insights (`rackInsights`), live semantic validation, and export breadth
(PNG/JPG/SVG/PDF/CSV/ZIP/HTML). **The gap is navigation and the physical data
model — not feature count.** Nothing in this plan trades any of the above away.

## Chosen approach (user-approved 2026-08-08)

User answered four scoping questions:

- **Priority:** all four areas accepted (port tracing, location hierarchy,
  unified rack canvas, network-side intelligence).
- **Schema:** additive bump approved → **v5**, forward-only, with fixtures.
- **Delivery:** **written plan first, code only on approval** (this document).
- **Refactor latitude:** granted, including rewriting tests whose assumptions
  change.

### Recommendation that departs from the brief (please read)

I originally framed workstream A as *"reconcile `rackCables[]` with `links[]`"*,
and the user picked it on that framing. **Having read the code I now think
merging the two collections is the wrong call**, and I want that on the record
before any code is written.

Merging would destroy the invariant at [types.ts:394](../../src/model/types.ts:394)
and drag the physical layer into `validate.ts`, `lib/health.ts`, NexText, and
the topology renderer — all of which currently assume `links[]` is purely
logical. That is a large blast radius across the most-tested part of the app.

**Proposed instead: a derived reconciler.** Keep both collections. Compute
end-to-end physical circuits from `rackCables[]` + port couplings, then *compare*
against `links[]` and report the delta:

| Situation | Meaning | Severity |
| --- | --- | --- |
| logical link **with** a physical path | documented and patched | ok |
| logical link **without** a physical path | designed but not cabled | `warn` |
| physical path **without** a logical link | undocumented cabling | `info` |

This delivers the intelligence the user asked for — "does my diagram match my
patching?" is a question no incumbent answers — with zero disruption to the
logical model, and it is pure and unit-testable. **RESOLVED 2026-08-08 (OQ-2):
user approved the derived reconciler over the merge.** The merge is not
scheduled; if the two-collection split ever proves genuinely limiting it gets
its own plan and its own review.

### Data model — schema v5 (all additive)

Three additions. Every field optional; absent → today's behaviour exactly.

#### 1. Port coupling (makes patch panels transitive)

A patch panel's front port and its rear punchdown are the *same physical
circuit*. Without modelling that, a trace stops dead at every panel.

```ts
export interface Interface {
  // …existing: id, name, kind, speed, vlan, notes, extra
  /** Which face this port sits on (v5). Absent → 'front'. */
  side?: 'front' | 'rear';
  /**
   * Internally coupled partner port ON THE SAME DEVICE (v5) — a patch-panel
   * pass-through. MUST be symmetric: a.throughTo === b.id && b.throughTo === a.id.
   * Asymmetry and cross-device references are validation errors, never silently
   * repaired.
   */
  throughTo?: string;
}
```

Rejected alternative: a shared `pairId`. It permits three-way coupling, which
is physically meaningless. A 1:1 `throughTo` with an enforced symmetry check is
narrower and provable.

#### 2. Location hierarchy

```ts
export type LocationKind = 'site' | 'building' | 'floor' | 'room' | 'row';

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  /** Absent → root. Cycles are a validation ERROR (never auto-broken). */
  parentId?: string;
  /** Short token for the fully-qualified path, e.g. "HQ", "28". Falls back to `name`. */
  code?: string;
  notes?: string;
  extra?: ExtraFields;
}
```

- New document collection `locations: Location[]`.
- `Rack.locationId?: string` — **`Rack.site` is retained, not deleted.**
  Dropping a populated field would violate the data-safety rule at
  [migrate.ts:4](../../src/model/migrate.ts:4).
- `Device.locationId?: string` — lets non-racked gear (wall ports, APs) carry an
  address, which is what makes Patchbox's `HQ/28/LA/APA4/01` possible.
- **The fully-qualified path is derived, never stored.** Storing it would
  duplicate state and drift on rename.

#### 3. Reconciliation carries no new fields

Derived at runtime from `rackCables[]` + couplings + `links[]`. Nothing persists.

### Migration v4 → v5

Purely additive, mirroring the v1→v2 shape:

```ts
4: (doc) => ({ ...doc, schemaVersion: 5, locations: Array.isArray(doc.locations) ? doc.locations : [] }),
```

Devices/racks/interfaces are **not** rewritten — every new field is optional and
absent means today's default. **No `site` → `Location` auto-conversion**
(RESOLVED 2026-08-08, OQ-1): it is offered as an explicit, undoable in-app
action instead, because silently inventing a location tree from free text would
be a surprising mutation of user data. Consequence to own: every existing
project opens with an empty navigator until the user runs the conversion, so
W2's empty state is a first-class surface, not an afterthought.

Required tests, matching the IRON RULE precedent at
[migrate.test.ts](../../src/model/migrate.test.ts): v4 loads and gains
`locations: []`; non-destructive; idempotent-safe; **v6 still refused**;
unknown-field round-trip preserved.

### Trace engine — `src/rack/cableTrace.ts` (new, pure)

Named `cableTrace` deliberately: `cablePath.ts` is SVG curve math and the two
must never be confused.

Graph model — two edge classes:
- **cable edge**: port ↔ port across devices (`RackCable.aEnd`/`bEnd`)
- **coupling edge**: port ↔ port within a device (`Interface.throughTo`)

Walk alternates cable → coupling → cable → coupling… from a start port.

```ts
export interface TraceHop {
  deviceId: string;
  ifaceId: string;
  /** How we ARRIVED at this port. */
  via: 'start' | 'cable' | 'coupling';
  cableId?: string;
}

export interface TraceResult {
  hops: TraceHop[];
  /** Why the walk stopped — surfaced in the UI, never swallowed. */
  end: 'terminated' | 'open' | 'loop' | 'ambiguous' | 'depth-capped';
}
```

**Transitive vs terminating device types** — RESOLVED 2026-08-08 (OQ-3):
**`patch-panel` only.** Everything else terminates. Rationale: a switch port is
an endpoint even if it is physically a pass-through in some exotic setup, and
guessing wrong produces confidently wrong traces — a trace that stops early is
honest, a trace that walks through a switch is a lie. `MAX_HOPS = 32` bounds the
worst case. The rule lives in one exported predicate (`isTransitive(type)`) so
widening it later — to `generic` splices, or a per-device flag — is a one-line
change plus tests, not a refactor.

## Accepted Scope

Sequenced by **dependency**, not by the order the user listed them. Each W
lands green: `tsc -b --noEmit` + full unit suite + e2e, each its own commit.

### W1 — Foundation & doc truth
- Fix [README.md:100](../../README.md:100) (the stale first-class-interfaces
  claim) and audit the rest of "What Is Not Ready Yet" against HEAD.
- `SCHEMA_VERSION` → 5, `MIGRATIONS[4]`, `locations: []` on the document,
  `createLocation` factory, full migration test set incl. v6-refused.
- Correct the misleading "schema v3" type comments now that v4/v5 exist.
- **No behaviour change.** Pure foundation.

### W2 — Location model + navigator (the "navigate" win)
- `Location` type, store actions (add/rename/reparent/delete) each one undoable
  transaction; `Rack.locationId` / `Device.locationId` wiring.
- Derived FQ path helper + breadcrumb (`PBX › Locations › HQ › 28 › RK001_M`).
- Locations tree navigator in the left panel; **replaces** the flat rack picker
  as the primary way to move around. Empty state when no locations exist —
  the app must stay fully usable with zero locations defined.
- Explicit, undoable "convert `site` names into locations" action (not automatic).
- Validations: `location-cycle` (error), `location-orphan-ref` (warn),
  `location-duplicate-sibling-code` (warn — makes FQ paths ambiguous).

### W3 — Trace engine (pure, no UI risk)
- `cableTrace.ts` per the contract above + `Interface.side`/`throughTo`.
- "Make pass-through pairs" bulk action for patch panels (pairs front port *n*
  to rear port *n*), one undoable transaction — a lazy user must never hand-pair
  24 ports.
- Validations: `port-coupling-asymmetric` (error),
  `port-coupling-cross-device` (error), `trace-loop` (warn).
- Heavy unit coverage before any pixel depends on it (see Test plan).

### W4 — Port scope + focus dimming (the visible payoff)
- Port becomes a selectable object: `selectedPort: {deviceId, ifaceId} | null`.
- Three inspector scopes — Rack / Device / **Port** — mirroring Patchbox. Port
  scope shows name, speed, VLAN, and **the full trace with FQ hop labels**.
- Click any hop → select that port. This is the navigation unlock.
- **Focus dimming** in both designers: selection at full contrast, everything
  else demoted. Must respect `prefers-reduced-motion` and remain WCAG-legible
  when dimmed — dimming is not a licence to drop below contrast minimums.

### W5 — Physical ↔ logical reconciler
- Pure `reconcile(links, rackCables, couplings)` → the three-way delta table
  above; new `Cabling` bottom-panel tab with jump-to-object.
- Feeds `rackInsights` so it becomes actionable, not just informational.

### W6 — Unified rack canvas (highest risk, deliberately last)
- Delete the `'focus' | 'row'` drill-in; one pan/zoom canvas over all racks in
  the current location, consuming `src/input/` — **no new gesture code**.
- Zoom-tiered LOD with **hysteresis** (separate enter/exit thresholds) so
  faceplates cannot flicker at a boundary:
  - far → rack outline + utilisation heat
  - mid → faceplates
  - near → individual ports, inline cabling, no drill-in
- Port hit-testing suppressed below the near tier (targets too small to hit
  honestly).
- **Rollout:** the old focus editor stays reachable behind a setting for one
  release, then is deleted. Cutting over blind is how the two shipped
  pointer-capture regressions happened (`pointer-native-canvas.md` audit).

### W7 — Close-out
- Export parity: traces/locations must render identically in live SVG and
  PNG/PDF/SVG/HTML export (reuse the W6 parity harness precedent from
  `rack-realism-callouts.md`).
- Update `README.md`, `TODOS.md`, `CHANGELOG.md`; retire the TODOS entries this
  plan supersedes ("Pan/zoom unified canvas + inline port editing", and the
  Phase-8 deferral of first-class `interfaces`/`assets`/`customFields`).

## NOT in scope

- **Merging `rackCables[]` into `links[]`** — see the recommendation above (OQ-2).
- **Obstacle-avoiding connector routing.** `PLAN.md` DA-ENG-H2 rates it
  multi-week; it is orthogonal to everything here. Stays in TODOS.
- **Text/Mermaid-to-diagram.** `NexTextDialog.tsx` already exists — extending it
  is its own plan, not a rider on this one.
- **True rear-face port art** (TODOS, P3). W6 makes the rear face far more
  visible, so this becomes more valuable — but it is artwork, tracked separately.
- Multi-page row PDF, auto-colour-by-speed, drag-between-racks in row view — all
  existing TODOS items, none blocked by or blocking this plan.
- Teams, accounts, cloud sync, telemetry. Permanently out.

## Error & edge-case contract

Enumerated because "don't assume anything" was explicit. Each row gets a test.

**Coupling / trace**
| # | Case | Contract |
| --- | --- | --- |
| E1 | `throughTo` asymmetric | validation ERROR; trace treats as open, never guesses |
| E2 | `throughTo` → iface on another device | validation ERROR; edge ignored |
| E3 | `throughTo` → nonexistent iface | validation ERROR; edge ignored |
| E4 | `throughTo` → itself | rejected at write time |
| E5 | cable loop back to start | `end: 'loop'`, visited-set guard, no hang |
| E6 | two cables on one port | `end: 'ambiguous'` — surfaced, not silently first-wins |
| E7 | chain > `MAX_HOPS` (32) | `end: 'depth-capped'`, shown in UI |
| E8 | panel with odd/unpaired port count | unpaired ports simply have no coupling; no error |
| E9 | device or iface deleted mid-trace | existing cascade prunes cables; trace recomputes from live state |
| E10 | cross-rack cable in a trace | must traverse normally |
| E11 | trace from a port with no cable at all | `hops: [start]`, `end: 'open'` |

**Locations**
| # | Case | Contract |
| --- | --- | --- |
| E12 | `parentId` cycle (A→B→A) | validation ERROR; FQ path derivation returns a marked partial path instead of hanging |
| E13 | `parentId` → deleted location | validation WARN; treated as root for display |
| E14 | delete a location with children/racks | **BLOCKED** with a count of what is still inside ("3 racks, 2 rooms"); user empties it first. No cascade, no silent reparent |
| E15 | duplicate sibling `code` | validation WARN — FQ path ambiguous |
| E16 | `kind` nested illogically (floor under room) | permitted, WARN only — real estate is messy; hard rules would fight users |
| E17 | zero locations defined | app fully functional; navigator shows empty state |
| E18 | depth > 16 | derivation caps and marks; no unbounded recursion |

**Unified canvas**
| # | Case | Contract |
| --- | --- | --- |
| E19 | LOD boundary flutter | separate enter/exit thresholds (hysteresis) |
| E20 | port targets too small at far zoom | hit-testing suppressed, not merely visually hidden |
| E21 | cable drag while panning / pinching | shared `src/input/` machine arbitrates; Escape cancels |
| E22 | `pointercancel` mid cable-drag | gesture aborts cleanly, no partial cable committed |
| E23 | undo during a drag | must not corrupt positions (a known prior failure mode) |
| E24 | 20 racks × 48 ports ≈ 1k ports | measured against the `src/perf/` harness before merge |

## Test plan

- **Unit (Vitest).** Every E-row above. Property test: random cable+coupling
  graphs → trace always terminates, never exceeds `MAX_HOPS`, and is symmetric
  (tracing from either end yields the reverse hop list). Property test: random
  location trees → FQ derivation terminates and cycles are always detected.
- **Migration.** v4→v5 loads, gains `locations: []`, non-destructive,
  idempotent-safe, v6 refused, unknown-field round-trip.
- **Store.** Each new action is exactly one undo entry; delete-cascade prunes
  couplings and `locationId` refs; undo restores them.
- **Component.** Three inspector scopes render and swap on selection; clicking a
  trace hop selects that port.
- **Export parity.** Live SVG vs `buildRackSvg` output for a traced, located
  rack — same structure, per the existing parity-harness precedent.
- **E2E (Playwright).** Build a two-panel patch chain, trace it end to end,
  reparent a location, reload and confirm persistence.
- **Perf.** E24 against `src/perf/` before W6 merges.

## Open questions — ALL RESOLVED 2026-08-08

No workstream is blocked. Recorded verbatim so the reasoning survives:

| # | Question | Resolution |
| --- | --- | --- |
| OQ-1 | `site` → locations: automatic or user-triggered? | **User-triggered**, explicit and undoable. Migration only adds `locations: []`. Accepted cost: empty navigator on existing projects until run. Blocks nothing. |
| OQ-2 | Derived reconciler or true merge into `links[]`? | **Derived reconciler.** Merge not scheduled; needs its own plan if ever revisited. |
| OQ-3 | Which device types are transitive? | **`patch-panel` only**, behind an `isTransitive(type)` predicate so widening is cheap. |
| OQ-4 | Deleting a non-empty location? | **Block** with a count of contents. No cascade, no silent reparent. |

## Scope Decisions

| # | Decision | Class | Rationale |
| --- | --- | --- | --- |
| SD-1 | Target v5, not v4 | fact | `SCHEMA_VERSION` is already 4; the type comments mislead |
| SD-2 | `throughTo` 1:1, not shared `pairId` | eng | 3-way coupling is physically meaningless; symmetry is provable |
| SD-3 | FQ path derived, never stored | eng | avoids duplicate state and rename drift |
| SD-4 | `Rack.site` retained alongside `locationId` | data-safety | dropping a populated field violates [migrate.ts:4](../../src/model/migrate.ts:4) |
| SD-5 | Derived reconciler, not a merge | eng | keeps [types.ts:394](../../src/model/types.ts:394) intact; small blast radius |
| SD-6 | Unified canvas last, behind a one-release fallback | risk | two pointer-capture regressions already shipped from blind cutovers |
| SD-7 | Trace engine before any trace UI | eng | pure logic proven by tests before pixels depend on it |
| SD-8 | Locations before port scope | dependency | FQ hop labels are what make a trace readable |
| SD-9 | Illogical location nesting warns, never blocks | UX | real buildings are messy; hard rules fight users |
| SD-10 | `site` conversion is user-triggered, never automatic | **USER** (OQ-1) | never silently invent structure from free text |
| SD-11 | Derived reconciler; merge unscheduled | **USER** (OQ-2) | reverses my own earlier framing — small blast radius wins |
| SD-12 | `patch-panel` is the only transitive type | **USER** (OQ-3) | a trace that stops early is honest; one that walks a switch is a lie |
| SD-13 | Deleting a non-empty location is blocked | **USER** (OQ-4) | impossible to lose a subtree by accident |

## Deferred to TODOS.md

Obstacle-avoiding routing; Text/Mermaid-to-diagram; true rear-face port art;
multi-page row PDF; auto-colour cables by speed/media; drag-between-racks in row
view; rack-level asset record (responsible person / manufacturer / purchase
date / operation start) as seen in the Patchbox rack inspector — worth doing,
but it is a form, not architecture.

## Constraints

Non-negotiable and unchanged: **no login, no cloud, no hidden upload.** Data
stays local (IndexedDB + `.nexmap`) unless the user explicitly exports. Nothing
in this plan adds a network call; `lib/netguard.ts` stays authoritative. The
moat remains **validate-as-you-draw** — tracing and locations exist to make
validation say more useful things, never to replace it.
