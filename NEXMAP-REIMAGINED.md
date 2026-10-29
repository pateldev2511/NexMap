# NexMap, Reimagined — v2 (reviewed)

> Hardened after three independent reviews (strategy / architecture / UX), each
> run cold against the real code. The reviews agreed on more than they disagreed.
> Local-first, no login, no cloud, no hidden upload stays non-negotiable.

## What the reviews changed (honest correction)

My v1 overclaimed. The reviews, reading the actual code, found:

- **Rack "physical truth" is ~70% already shipped.** `rackPower.ts` (A/B feed
  failover + single-corded power-SPOF), `rackAirflow.ts` (hot-aisle direction
  conflict), `rackBudget.ts` (U + watts + weight vs caps), `rackCatalog.ts` (30
  real models), `rackTypes.ts` (4-post / 2-post / wall-mount / IDF / 23"). So
  "real racks" was mostly re-labeling. Genuinely new: **depth-fit** (no depth
  field on Rack or Device — highest-risk gap in C), cable-management + patch
  schedule + parts-list→rack, soundproof preset data.
- **3 of 4 icon "skins" already exist** — `deviceVisuals` (line), `deviceFlatArt`
  (flat), `deviceIso` (iso), switched by `View.projection` with no schema field.
  Only **blueprint** is new. The skin system is render-layer, not schema.
- **The capacity heatmap has no input data.** `Link.bandwidth` is a free-text
  *capacity* label ("1G"); there is no load/demand field anywhere. Utilization =
  load ÷ capacity, and the model has neither term. Shipping a heatmap would imply
  telemetry we don't have. **Cut from v1.**
- **"Simulation" oversells an undirected, weightless graph** with no L3/IP-per-
  interface and no routing table. Honest framing is **reachability**, not routing.
- **Conductor's plain-language intent collides with no-cloud** and would be a
  brittle gimmick. The declarative half (type-to-summon, templates, lasso-to-
  fabric) reuses NexText almost wholesale; imperative NL-edits are a separate,
  much larger track.

## The thesis (sharpened)

NexMap's one proven, already-shipped differentiator: **it catches your network-
design mistakes while you draw — offline, free, no account.** That is the moat
(a validate-as-you-draw health engine with SPOF/bridge/redundancy already lives
in `src/lib/health.ts`). The 10x is not breadth. It is deepening correctness from
*"is this drawn right?"* to *"what happens when it breaks?"*

Drawing is the commodity. **Reasoning about failure is the moat.**

---

## THE HERO — "Stress-test your design" (blast radius)

All three reviews converged here independently. Not packet animation, not intent.
**Click any device or link and watch the network recoil.** It answers the question
every network person feels in their gut: *what dies if this dies?* No lightweight
tool does this. It rides on code that already exists.

### How it feels, second by second (the spec to build)

In **Flow** — a read-only *lens* (a top-level toggle like the existing flat/iso
switch, not a 7th tool: it freezes the topology, dims editing chrome, turns the
canvas into an instrument; leaving it drops you back exactly where you were):

- **0.0s hover** — the hovered device lifts slightly; everything downstream of it
  pre-highlights. You already sense "this one matters."
- **0.0s click — the pull** — the device desaturates and *drops out* of the plane
  (a weighty ~120ms fall). It must feel like yanking a cable, not a checkbox.
- **0.1–0.6s — the blast blooms** — a red wave propagates *along the links* at a
  followable speed to every node that just lost all reachability. Nodes that
  survive via another path instead **reroute**: the signal animation re-flows onto
  the backup link in the same beat — you watch traffic find the detour. Survivors
  settle calm; casualties stay red. The contrast is the whole point.
- **0.6s — the verdict, one quiet line** — "**17 devices isolated · 2 sites
  unreachable · no redundant path**" or "**0 lost — rerouted via core-b**". That
  second message is the one that makes a skeptic trust the tool.
- **release — instant, reversible** — click again / Esc and it snaps back, red
  drains, signals restore. Zero cost to experiment → "I can't stop poking it."

This is the first time motion *answers a question* instead of shimmering. It
reuses — and redeems — the signal animation I shipped earlier.

### What it reuses (already in the code)

- SPOF / cut-vertices / bridges → `health.ts` `cutVerticesAndBridges`,
  `articulationPoints` (iterative, stack-safe).
- Connected components / fragmentation → `health.ts` `countComponents`,
  `analyzeHealth`; undirected adjacency → `buildAdjacency`.
- Link stroke single source of truth (tint hook) → `connector.ts`
  `deriveLinkStroke`; ECMP fan-out geometry → `parallelPoints`.
- The signal-flow animation layer → `Canvas.tsx` / `Canvas.module.css` (reroute).

### What's net-new (small, testable, pure functions)

- `blastRadius(graph, failed)` → the set of nodes that lose all reachability to a
  chosen anchor/source set when `failed` is removed (recompute components with the
  node/edge cut). O(V+E).
- `shortestPath(graph, a, b)` + `ecmpPaths` → BFS parent-tracking + k-path
  enumeration (today `edgeDisjointPaths` returns a *count*, not a path).
- A `sim/` module (pure, unit-tested) + a Flow-lens overlay layer.

### The build-time trap the eng review caught (must-do)

`projectStore.visibleLinks()` only returns links with an endpoint inside the
viewport — a traced path or blast wave crossing off-screen would be **clipped at
the viewport edge**. So the active path / blast-radius renders as a **dedicated
overlay layer NOT subject to `visibleLinks` culling** (query the full path set
directly), and the animation is driven by CSS/attribute mutation, **not** a React
re-render of the whole scene. This is the difference between 60fps and jank.

### Honest MVP boundary (no lying)

- It's **reachability**, labeled as such — not L3 routing.
- **No capacity heatmap** until there's a real load model.
- **Network view only.** "Fail a PDU → the network reroutes" needs a logical↔
  physical mapping that **does not exist** (links[] and rackCables[] are two
  disjoint graphs by design) → a schema v5 milestone, explicitly deferred.

---

## Pillar B — CONDUCTOR, descoped to what's honest and local

Ship the **declarative** half (reuses `nextext.ts` `parseNexText`/`buildModel`
+ `layout.ts` autolayout + `ipam.ts` `nextFreeHost`):

- **Type-to-summon** — unify with the existing `CommandPalette` (Cmd+K): pressing
  a letter on empty canvas opens the *same* palette pre-filtered to "create," so
  there's one mental model, not two type-driven surfaces.
- **Templates that scaffold** validated topologies (3-tier / collapsed-core).
- **Lasso-to-fabric** — fill a region with a subnet (reachable also from the lasso
  tool's context menu, so it's discoverable, not a secret gesture).

Deferred (flagged, not assumed "just more NexText"): **imperative plain-language
edits with preview-diff** — a different grammar + stageable model-diff infra the
store doesn't have (history is command-based). Auto-IP per interface also needs a
schema add (`Interface` has no `ip`). Separate milestone.

## Pillar C — SUBSTANCE, retargeted to the genuine gaps

Reuse everything that exists (power/airflow-direction/weight/caps/catalog/presets).
Genuinely new, in order:

1. **Depth-fit** — add depth to Rack + Device (schema v5 additive), validate like
   the existing budget checks. The one rack gap with no data today.
2. **Cable-management lanes + patch schedule + parts-list→rack** paste — the real
   time-saver.
3. **Blueprint skin** + a formal **icon-system spec** (one 24×24 grid, one stroke
   weight, one corner radius, a shared silhouette skeleton per device *type* every
   skin traces, one source of truth for port/form-factor geometry). Line stays the
   house style; flat/iso are already done; blueprint is the only net-new skin.

Explicit policy decision needed: success criterion "reject a physically impossible
build" **contradicts** today's optional-caps, warn-never-block design. To "reject"
we'd default caps from the chosen preset and promote over-power/over-weight to a
*blocking* severity. Decide before building C.

---

## Interaction model (the glue the reviews demanded)

Two states the user holds in their head, not three:

- **Edit** (today's modes) ⇄ **Flow** (the read-only stress-test lens).
- **Conductor is ambient**, never a mode — summon/fabric live inside normal select.

Canvas-first and uncluttered: the topology is the hero; the Flow toggle and a
faint first-run summon hint ("Type to add a device · Drag a box to fill a region")
live at the periphery and fade on first use. The rack is a drill-down from a node.

---

## Success criteria (practitioner job, not demo-wow)

- Clicking one device shows its **blast radius + one-line verdict** in < 1s — a
  thing no lightweight tool does.
- A real **SPOF / isolated segment** is found on a diagram the user already had.
- Flow lens enters/leaves with zero data mutation and zero lost edit state.
- Still: no login, no cloud, no upload; strict CSP + netguard green;
  `tsc`/`eslint`/tests green; 60fps blast-radius on a 200-node diagram (overlay,
  not culled, CSS-driven).

## Sequencing

1. **HERO: Stress-test / blast radius** (network view). Reuses the health engine;
   biggest differentiation; redeems the earlier animation. Build a real slice.
2. Declarative Conductor (summon/templates/fabric).
3. Substance: depth-fit → cable-mgmt/parts-list → blueprint skin.

Deferred bets (not this cycle): rack↔network coherence (schema v5), capacity
heatmap (needs a load model), imperative NL edits, the air-gapped/regulated
beachhead as a positioning play (strategy review's strongest reframe — worth a
real decision later).
