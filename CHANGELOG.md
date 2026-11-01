# Changelog

All notable changes to NexMap are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). NexMap is pre-1.0, so
minor/patch semantics are not yet enforced.

## [Unreleased]

Two big pushes land together: the **NexMap Deck** — a reimagined, command-first
entry experience with a dark-first design-system restyle — and the **living
canvas**, where the diagram itself now reads as a live, breathing network from
the cables down to the hardware, with a user control to dial the motion.

### Added

- **Carry your rules to the next design.** The Rules tab (and ⌘K) can save a
  design's rules as a small `.nexrules` file and load rules into another design,
  from a rules file or straight from any `.nexmap` design. Loading merges as one
  undo step: new rules are added, the same rule with another minimum takes the
  file's number, and nothing already declared is dropped. The banner says what
  happened: "Loaded 2 rules from “Site standard.nexrules”: 2 added — 1 not met."
  A file that isn't one, or a design with no rules, says so and changes nothing.
  Files are written with a download and read with the file picker; nothing leaves
  your machine.
- **⌘Z undoes rule changes too.** Declaring, retracting, tightening or locking in a
  rule is now an undo step, in the same history as your edits, so ⌘Z after "at
  least 3 firewalls" puts the rule back to 2. Since nothing on the canvas changes,
  the banner says which step it was: "Undid: Change At least 2 “firewall” to 3." /
  "Redid: …". A retracted rule comes back unchanged (same rule, same minimum).
  Opening another design clears these steps along with the rest of history.
- **Change a rule by saying it again.** With "At least 2 “firewall”" declared,
  typing "need at least 3 firewalls" in ⌘K offers "Change rule: At least 3
  “firewall” (was 2)" with its live preview ("1 short"). Choosing it changes the
  declared rule in place instead of adding a second one, and says "Tightened to …
  (was 2) — 1 short." Count and "connects to ≥N" rules also get small − / +
  buttons in the Rules tab (never below 1). Saying the same rule with the same
  number says it's already declared. Changing a rule's minimum is a rule change,
  so the edit guard doesn't later report it as "That edit broke …".
- **See your load-bearing devices on the canvas.** A device that a met rule can't
  lose (delete it and the rule breaks) gets a small accent column mark at its
  bottom-left, with a tooltip and screen-reader text ("holds up a declared rule").
  In a dual-firewall, dual-core design, the two firewalls and two cores are marked
  and the access switches aren't. Add a third firewall and those marks go, since no
  single firewall is load-bearing anymore. The mark sits in the opposite corner from
  the amber "breaks a rule" diamond, so a device can carry both.
- **Rule checks stay fast on big designs.** The single-point-of-failure scan now runs
  in one linear pass (articulation points against the egress set) instead of one
  failure simulation per device, with the same results; a randomized test checks it
  against the old method. "Held up by" answers most rules directly instead of
  re-checking everything per device. On 1,000 devices it takes about 55 ms, down
  from about 1.5 s. It's reused until a device's type, role or name, a link, or a
  rule changes, so dragging and re-addressing cost nothing. Above 1,000 devices the
  SPOF rule shows plain "met" instead of "held up by". The Inspector, the Rules tab
  and suggestions now refresh after each validation pass instead of on every drag
  frame and keystroke.
- **New devices follow your naming standard.** With "every firewall is named FW-#"
  declared, a firewall you add gets the next free standard name ("FW-4") instead of
  "Firewall 4". That covers dropping one on the canvas, quick-creating one from
  another device, "Add Firewall" in ⌘K, an added twin, Harden, Connect to internet
  (when ISPs have a standard) and Restore for count rules. A role standard covers
  twins of that role ("CORE-3"). Devices with no standard, or whose template
  Conductor can't fill in, keep the usual default name.
- **Naming rules: "every firewall is named FW-#".** A new rule kind for naming
  standards. In the template, `#` is a number and `*` is anything; the rest is
  literal and case-sensitive. Devices are picked by role or type, like count rules.
  You can say it in ⌘K ("every firewall is named FW-#", "name every switch SW-#",
  quotes for spaces: `"Core #"`) or pick "is named like" in the Rules tab. Offenders
  read "“Firewall 7” doesn't match “FW-#”". Restore renames them to the next free
  numbers in reading order (top to bottom, left to right): "Renamed 2 devices to
  fit “FW-#”: FW-2, FW-3." A template it can't fill in (a `*`, or more than one
  `#`) says so instead. Restore all names freshly added twins to the standard
  before the generic "every device is named" rule runs. Suggestions offer a
  template every device of a group already follows (FW-1, FW-2 → "FW-#"), but only
  in room left after the protective rules. Naming rules travel in rules files and
  appear in exports.
- **Quick fixes don't deepen a rule that's already broken.** A suggested cut now
  never removes an uplink a "connects to ≥N" rule is counting on. Before, when the
  guest's own link was locked, Conductor could suggest cutting an access switch's
  only core uplink, because dual-homing was "already broken". Apply all also
  leaves links on a locked layer alone, and that's now tested.
- **Apply every quick fix at once.** When more than one quick fix is on offer, the
  Rules tab shows "3 quick fixes for broken connectivity and isolation rules · Apply
  all", and ⌘K has "Apply all 3 rule fixes". Conductor plans them one at a time
  (cuts first, then uplinks), re-checking after each, so later fixes take earlier
  ones into account. It applies them as a single undo step and reports what it
  did: "Applied 3 fixes: cut Guest SW–C1; connected A1 to C2; connected A2 to C2.
  Every declared rule is met. ⌘Z undoes all of it." Links on a locked layer are
  left alone. When no fix exists, it says the broken rules need a choice Conductor
  won't make for you.
- **Fix broken rules from ⌘K and the Inspector too.** The same quick fixes as the
  Rules tab's why-list are now ⌘K commands ("Connect A2 to C2 · fixes Every
  “access” connects to ≥2 “core”", "Cut Guest SW–C1 · fixes No “guest” may reach
  “access”"). Selecting a device that breaks a rule shows its fix right under that
  rule in the Inspector. All three use one list and one action, so they always
  agree. Fixes are also planned together: suggested uplinks are chosen as if the
  suggested cuts were already made, so Conductor won't suggest wiring an access
  switch to the guest's core, which would let the guest back in after the cut.
- **See how a walled-off role gets through, and cut it from the why-list.** A
  broken "no guest may reach access" now names the route, not just the endpoint:
  "reaches “access” A1 via C1", in the Rules tab and in exports. The row offers
  "Cut Guest SW–C1": a link on that shortest path whose single cut separates them.
  It starts at the guest end, skips doubled links and cuts that leave another way
  round, and never offers a cut that would break another rule that holds now. The
  cut uses the same delete as the Delete key (locks, enforcement and the edit guard
  all apply), and ⌘Z puts the link back. Suggested uplinks for a connectivity rule
  are also now judged together, so two links that are each fine alone but break a
  rule together aren't both offered.
- **Fix a missing uplink from the why-list.** When "every access connects to ≥2
  core" is broken, each short switch in the why-list gets a "Connect to C2" button,
  one per missing uplink. It prefers the core with the fewest access switches
  already on it, and never suggests a link that would break another rule that
  holds now. For example, it won't suggest a core on the guest island when "no
  guest may reach access" is declared. Conductor only suggests; you click, and ⌘Z
  takes the link back. The delete preview also now counts only what Delete would
  really remove: locked devices and anything on a locked layer are left out, and it
  says so ("1 locked — Delete leaves it").
- **Preview what deleting a selection or a link would break.** Select several
  objects, or one link, and the Inspector's Rules group says what deleting them
  would do: "Deleting these breaks At least 1 “firewall” — 1 short — none of them
  alone holds it up; together they do." If the rule is enforced, it says the delete
  will be blocked. That "together" case is the one the single-device view can't
  show: a redundant pair where neither box alone is load-bearing. When nothing would
  break, it says so ("Deleting this link breaks no declared rule.").
- **You can see enforcement before you act, and it travels with your rules.**
  Selecting a device that holds up an enforced rule shows "Holds up At least 2
  “firewall” · enforced — deleting it would break the rule (1 short), so the delete
  will be blocked." On the canvas, its load-bearing mark gets a ring, and the
  tooltip and screen-reader text say a delete will be blocked. Saved rules files now
  record which rules are enforced, and loading rules (from a `.nexrules` file or a
  `.nexmap` design) enforces those here too, without un-enforcing anything you
  already enforce ("… 1 now enforced").
- **Enforce a rule, and Conductor holds the line.** Each declared rule in the Rules
  tab has a lock. While it's on, an edit that would break the rule is taken back
  as soon as it settles: "Blocked: that delete would break At least 2
  “firewall”, which is enforced. Stop enforcing it in the Rules tab to make this
  change." A field edit is judged when you leave the field, not keystroke by
  keystroke. The blocked edit is gone, not parked on the redo stack. Undo and redo
  are never blocked (they warn as before). Turning enforcement on or off is an undo
  step, a retracted rule stops being enforced, and the setting is saved with the
  design (older builds open the file and simply don't enforce).
- **VLAN rules see rack patch cables too.** A camera patched in the rack view into
  a VLAN 10 switch port now breaks "every camera is on VLAN 20", even with no link
  drawn on the canvas, and Restore retags that port. A port reached by both a link
  and a cable counts once. Every place rules are checked (Rules tab, Inspector, ⌘K
  preview, suggestions, CSV/HTML/PDF exports) now reads the same design, cables
  included, so they can't disagree.
- **VLAN rules check the switch port, not just the address.** A camera at
  10.20.0.10 patched into a VLAN 10 access port now breaks "every camera is on
  VLAN 20", with the reason "SW1 Gi0/3 is on VLAN 10". Conductor reads the far
  end's port VLAN, the device's own port VLAN, and a single VLAN typed on the
  link. Trunks and untagged ports are left alone. Restore retags the wrong ports to
  the rule's VLAN in the same undoable step as any re-addressing ("Retagged 1
  port to VLAN 20 (SW1 Gi0/3)."). Subnet rules still look only at the address.
- **Every edit is held to your rules, not just deletes.** Re-address a camera out
  of its VLAN, unplug an uplink, or undo a fix, and once the edit settles Conductor
  says what it broke: "That edit broke Every “camera” is on VLAN 20. ⌘Z puts it
  back." (after an undo: "⌘⇧Z puts it back"). It waits until you leave the field,
  so a half-typed IP doesn't set it off. The banner clears itself once the rule
  holds again. Declaring a rule that's already broken, or opening another design,
  isn't reported as an edit that broke it.
- **Rules can name a VLAN.** Say "every camera is on VLAN 20" in ⌘K, or pick
  "VLAN 20" as the target in the Rules tab. A device is on VLAN 20 when its
  management IP sits in any subnet tagged VLAN 20. The why reads "10.10.0.50 is in
  “Office” (VLAN 10), not VLAN 20". Restore re-addresses into the VLAN's subnet
  when it has exactly one; when it spans several, Conductor says so instead of
  guessing. "vlan20", "VLAN-20" and "VLAN 20" are the same rule. Suggestions offer
  a VLAN rule when a role is spread across several subnets that share one VLAN.
- **See which devices a rule depends on.** A met rule in the Rules tab now shows
  "held up by N" when some devices can't be lost without breaking it. Clicking it
  selects them on the canvas and lists what deleting each would leave ("FW1 · Delete
  it and the rule breaks (1 to fix)"). A rule with slack just says "met". It's the
  same check as the Inspector's "Holds up", run per device, so the two always agree.
- **See what a device means to your rules before you touch it.** Once the design
  declares rules, the Inspector gets a Rules group for the selected device. It lists
  the rules the device breaks (with the same reason as the Rules tab), and the rules
  it holds up: rules that are met now but would break without it ("Holds up At least
  2 “firewall” · delete it and the rule breaks (1 short)"). Deleting something that
  breaks a rule that held now says so: "That delete broke At least 2 “firewall”. ⌘Z
  puts it back." Both use the same evaluators as the Rules tab, so they can't
  disagree with it.
- **Conductor suggests rules from your design.** The Rules tab has a "Suggested
  from your design" list, and ⌘K has matching "Lock in rule: …" commands. They
  offer what the design already does, as rules to keep: "At least 2 “firewall”",
  "Every “access” connects to ≥2 “core”", "Every “camera” lives in “CCTV”", "No
  “guest” may reach “core”". Every suggestion is true right now (checked by the
  same evaluator the rules use), never already declared, and capped at eight, mixed
  across kinds so no one kind crowds out the rest. Uplinks are suggested pointing
  toward the edge (access → core, not core → access). One click declares it, so a
  later edit that breaks it gets flagged. Declaring or retracting a built-in rule
  now confirms in a toast, like authored rules do.
- **Count rules: "at least 2 firewalls".** Type it in ⌘K ("need at least 2 firewalls",
  "at least 3 core") or pick "exist (count)" in the Rules tab. A count matches a
  device's role or its type, so "firewalls" works with no roles set. When it's short,
  the rule says "1 short" (no device is to blame, so nothing is badged), and Restore
  adds copies of the best-connected one: same type and role, wired to the same
  neighbors, no IP. With nothing to copy yet, it says so instead of guessing.
  The CSV, HTML and PDF reports show the gap ("1 present, 1 short").
- **Redundant twins keep their role.** A twin of a "core" switch, from Add a
  redundant twin or Harden, is now a "core" too, so it counts toward your rules.
- **Shared designs carry their rules.** The standalone HTML export now has a Rules
  sidebar: the verdict ("1 of 4 rules met"), each rule marked ✓ or ✕, and every
  offender with its reason. Click a name and that device is ringed on the diagram;
  click again to clear it. The PDF export (and the PDF in the ZIP package) adds a
  rules page after the diagram. Both are checked against the whole design, and
  neither shows anything when no rules are declared.
- **Rule breakers are marked on the canvas.** A device that breaks a declared rule now
  carries a small amber diamond at its top-left corner. It appears and clears live as you
  edit: restore the camera placement rule and the cameras' marks disappear. It's
  deliberately unlike the red validation badge (different shape, mark, color and corner),
  so a device can carry both and each reads without relying on color. Hover says "Breaks a
  declared rule — see the Rules tab", and screen readers hear "…, breaks a declared rule".
  Works in both the flat and isometric views.
- **Export your rules as an audit trail: CSV · Rules.** A new export format writes every
  declared rule with its status. A met rule takes one row, and a broken one takes a row per
  offender, with the same reason the Rules panel shows: `Every “camera” lives in “CCTV”,
  placement, broken, Cam Lobby, 10.10.0.21 is in “Office”, not “CCTV”`. It's the
  evidence a design review or a regulated sign-off asks for, and it's produced entirely on
  your machine. Rules describe the whole design, so the report always checks the whole
  diagram (the dialog hides Scope for it), never a selection. A rule written by a newer
  NexMap is listed as "not checked", never as "met". Cells get the same spreadsheet-
  formula guard as the other CSVs. The **ZIP package** now includes `rules.csv` whenever
  the design declares rules.
- **Every broken rule says why, one line per offender.** Clicking a rule's "N to fix" still
  selects the offenders, and now also opens a short list under the rule. Each offender is
  named, with what about it breaks the rule: "Core SW: its failure cuts off 3 devices",
  "Cam Lobby: 10.10.0.21 is in “Office”, not “CCTV”", "Cam Dock: no management IP",
  "Guest Kiosk: reaches “internal” HR-DB", "acc-1: links to 1 of ≥2 “core”". Click one to
  focus it on the canvas. The reasons are recomputed from the same checks that flagged
  them, so they can't disagree with the count. Custom rules also join ⌘K's **Rules**
  group, so you can retract one by name ("retract guest") from the keyboard.
- **Declare a rule by saying it, in ⌘K.** Type the rule as a sentence and the palette
  offers it as the top result: "every camera lives in CCTV", "no guest may reach
  internal", "guests must not reach internal", "isolate guest from internal", "every
  access connects to at least 2 core". Enter declares it. The hint previews what it
  would do *before* you commit: "1 to fix", "met now", "already declared" (shown greyed
  out, so you can't add a duplicate), or "no “guests” devices yet" when no device carries
  that role (so a typo or a not-yet-used role doesn't read as "met"). It's a small,
  fixed grammar that runs locally (no model, no network) and either reads the sentence
  exactly or offers nothing. It never half-guesses a rule. Plurals resolve to a role
  the design already uses ("cameras" → "camera"), a subnet takes its real spelling
  ("cctv" → "CCTV"), and multi-word names go in "quotes".
- **Placement rules — "every camera lives in CCTV."** A third kind of custom rule pins a
  role to a subnet: "Every *camera* lives in *CCTV*", naming the subnet by its name or
  CIDR (with a datalist of the design's subnets). Conductor checks each device's
  management IP against the range live, and flags any that sit elsewhere or have no
  address yet. It's the addressing half of segmentation, next to isolation's wiring half.
  And it's the first custom rule Conductor can **restore**. Re-addressing into a named
  range is deterministic, so one click moves every offender to the next free host in that
  subnet, skipping the gateway and every address already in use, in one undoable step.
  "Restore all" runs placement before auto-address, so an unaddressed camera lands
  straight in CCTV instead of the first subnet. It refuses rather than guesses: when no
  subnet has that name, or two do, nothing moves and the rule says why. Only the
  management IP moves; ports keep their addresses. No schema bump is needed, because
  custom rules already round-trip unknown kinds.
- **Declarative invariants — the rules your design asserts about itself.** A new
  **Rules** tab turns Conductor from "fix what's wrong now" into "hold this design
  to what I declare." Where validation flags mistakes, an invariant is a *goal* you
  opt into — "No single point of failure," "Every device is addressed," "Every device
  is named," "Every subnet has a gateway" — and once declared, Conductor shows live,
  as you edit, whether the design still meets it. A declared rule reads **met** or
  shows how many objects break it, with one click to select them on the canvas. Add a
  redundant path and the no-SPOF rule goes green on its own; blank a name and the
  naming rule lights up. Each rule is a pure check composed from primitives NexMap
  already trusts (the failure-scan, addressing, gateway and naming logic), so a rule
  never claims more than the underlying check knows. And a violated rule isn't just
  flagged — it offers a one-click **Restore**: Conductor runs the fixer that owns the
  remedy (harden the single points of failure, auto-address the unaddressed devices,
  name the blank ones, adopt gateways), in one undoable step, then the rule re-checks
  and shows whatever it couldn't safely close. Declare "No single point of failure,"
  hit Restore, and watch Conductor twin the weak device and the rule go green. And the
  rules you declare now **travel with the design** (schema v6): they're written into the
  `.nexmap` file and the autosave draft, so reopening a project restores its rules and
  re-checks them against the diagram. The invariant list round-trips unknown ids too, so
  a rule from a newer build survives a trip through an older one. And when several
  declared rules are broken at once, a **Restore all** button brings the design into
  compliance in one move — Conductor runs the remedies in dependency order (harden the
  single points of failure first, then name and address the twins that creates, then
  adopt gateways), so a rule a fix momentarily breaks still gets mended in the same pass.
  And you can now **author your own rules** (schema v7): a "Custom rules" section lets you
  declare role-based connectivity — "Every *access* connects to ≥ *2* *core*" — straight
  from the design's own device roles, with a datalist of the roles already in use. Conductor
  checks it live as you wire things up (dual-home the access switch and it goes green), the
  rule is selectable to its offenders, and it travels with the `.nexmap` file like the
  built-ins. Rules come in two kinds: **connectivity** ("every access connects to ≥2 core")
  and **isolation** ("no *guest* may reach *internal*") — the segmentation check. Isolation
  is path-level: it flags any device that shares a connected fabric with a role it's supposed
  to be walled off from, so cutting the link that bridges them turns it green. That's the
  air-gap / separate-fabric test NexMap's local-first stance is built for; it checks wiring,
  not firewall or VLAN policy, so two roles meeting at a firewall still read as "can reach."
  These authored rules flag but don't auto-restore — Conductor won't invent (or cut) links.
  Rules are reachable by intent from ⌘K, too: a **Rules** group lets you declare or retract
  each built-in rule from the keyboard (the hint shows its live status — "not declared",
  "met", "2 to fix"), and when declared rules are broken, a "Restore N declared rules"
  command joins the Suggested section at the top.
- **⌘K search ranks what you typed first.** Searching used to return matches in list order,
  so a loose letter-by-letter match could beat an exact one — typing "restore" landed on
  "Add a redundant twin…" before "Restore 1 declared rule". Results are now ranked: label
  prefix, then word start, then anywhere in the label, then the hint, and loose
  in-order matches last.
- **Per-port IP addresses (schema v5).** Interfaces are now addressable, not just
  the device. Each port in the inspector has its own IP field with live validation
  and a one-click **Suggest** that pulls the next free host (preferring the device's
  management subnet). Every address check — duplicate, invalid, outside-every-subnet
  — now covers port IPs exactly as it does management IPs, so a clash between a port
  and a device, or between two ports, is caught. And a new Conductor move,
  **"Auto-address interfaces,"** fills every unaddressed port in one undoable step:
  each port inherits the subnet of its device's management IP and takes the next free
  host. It's honest about its limits — a device with no management IP, or whose
  management IP sits in no subnet, is skipped rather than guessed, and existing port
  IPs are never overwritten. The schema bump is backward-compatible: older files load
  and gain the field; v5 files are protected from older builds that would drop it.
  The existing Conductor fixers follow the ports all the way: **Resolve duplicate IP
  addresses** now re-homes a clashing *port* (keeping the management IP over a port
  when they collide), and **Draw subnets to cover orphan addresses** draws a range for
  a *port* outside every subnet — so the one-click Fix buttons the Validation panel
  shows on a port's issue actually resolve it, not just the device's.
- **Conductor — build by intent, from the one palette.** A faster, declarative
  way to design, all through ⌘K:
  - **Fix it from the Issues panel.** Every Conductor fix now has a one-click button
    right where the problem shows up: a flagged issue in the Validation panel —
    duplicate IP, orphan address, missing gateway, dangling link or interface ref,
    duplicate or blank name — carries a **Fix** button that runs the matching move
    and clears it, no palette hunting. Only issues with a safe, deterministic remedy
    get a button; judgment calls (invalid addresses, overlaps, rack collisions) stay
    for you to decide. This closes the loop the whole feature is built on: the
    diagram flags it, and you fix it without leaving the flag.
  - **Fix all safe issues, in one move.** When several issues have safe remedies,
    the Validation panel offers a single "Fix all safe issues" button (and a ⌘K
    command) that runs every automatic fix in dependency order — prune, clear refs,
    name, de-dupe names, de-dupe VLANs, re-address, cover, assign gateways — and reports a combined
    summary ("Conductor fixed: 1 unnamed device, 3 duplicate names, 1 duplicate IP,
    1 new subnet, 1 gateway"). It only does the moves that can't guess, so it stops
    exactly where judgment begins: a freshly drawn subnet with no router inside it is
    left without a gateway rather than handed an invented one.
  - **Summon at cursor, intent-aware.** Type a device name — "firewall", "switch",
    "router" — and it appears *where you're looking* (the viewport center, nudged
    clear of anything already there) and **auto-wires** so it joins the topology
    instead of floating: to the device you have selected when there's exactly one
    (summon again and it chains off the new node), otherwise to the nearest node
    within reach. Repeated summons auto-number — "Server", "Server 2", "Server 3" —
    so a tier reads like a design, not a stack of identical labels. One undo.
  - **Scaffold a whole topology.** "Insert: …" drops a complete, validation-clean
    network — redundant core (HA), DMZ perimeter, data-center rack, three-tier
    campus, a 3-tier app stack (load balancer → web → app → database, HA-meshed),
    and more — laid out and wired at the viewport, as one undoable step. Reuses the
    curated starter registry; management IPs are dropped on insert so a template
    never collides with the addresses already on your canvas.
  - **Weave a lasso into a fabric.** Select a scatter of devices and "Weave into a
    fabric" (⌘K, or the selection toolbar) connects them into one clean mesh — a
    euclidean minimum spanning tree, shortest total wire, no cycles — skipping any
    pair already linked, so re-weaving is idempotent. A pile of nodes becomes a
    connected topology in a click.
  - **Wire a lasso to its hub (star).** The other half of real topologies: select
    some clients plus the one switch/router/firewall they hang off, and "Wire
    selection to its hub" (⌘K, or the toolbar) stars every client to that hub. It
    refuses to guess — zero or several infrastructure nodes in the selection and it
    does nothing — and skips links that already exist, so it's idempotent too.
  - **Segment a lasso into a subnet.** The missing verb between drawing and
    addressing: select a group (a DMZ, a server tier) and "Segment selection into a
    subnet" (⌘K) carves it its own network — picks the next free private /24 that
    overlaps nothing on the canvas, creates a named subnet ("Segment", "Segment 2",
    …), and addresses the selection's unaddressed members into it from .1. A flat
    drawing becomes a segmented design one lasso at a time. Never re-homes a device
    that already has an IP; invents no empty subnet when nothing needs one. When the
    group holds a single router or firewall, it's adopted as the subnet's gateway
    (addressed .1) — so the new subnet is complete, not flagged for a missing one.
  - **Auto-address the topology.** "Auto-assign IP addresses" (⌘K) gives every
    addressable device without an IP the next free host from your subnets — and
    when you have none (the usual case right after inserting a template), it
    creates a default `10.0.0.0/24` and fills from there. One undoable step from a
    drawn shape to a specified network. Never overwrites an address, never
    collides, skips external/abstract nodes (ISP, cloud), and shares lib/ipam's
    allocation policy with the inspector's one-at-a-time "Suggest". When it has to
    create that default subnet and a single router/firewall is being addressed, that
    device becomes the subnet's gateway, so the result is a complete, clean design.
  - **Connect to the internet (uplink).** The last declarative step a diagram
    usually wants: "Connect to the internet" (⌘K) wires your edge device to an ISP.
    It finds the box that faces the world — a single firewall (the perimeter by
    definition, so it wins even when routers are present), else a single router —
    reuses the internet node you've already drawn or creates one above the edge, and
    links them, as one undoable step. Refuses to guess when the edge is ambiguous
    (two firewalls, or several routers with no firewall), is idempotent (an edge that
    already reaches an ISP is left alone), and never spawns a second internet cloud.
  - **Add a redundant twin (fix a single point of failure).** Where Conductor and the
    Flow lens meet: Flow *reveals* that losing one device isolates everything behind
    it; this *fixes* it. Select the single point of failure and "Add a redundant twin"
    (⌘K) clones it beside itself and wires the twin to the same neighbors, so traffic
    has a parallel path and failing the original cuts no one off — re-run Flow and the
    blast radius collapses to nothing. The twin lands *without* the original's IP (a
    duplicate address would be a real error), so it's ready for auto-address next. One
    undoable step. Refuses when the target is ambiguous (zero or several selected) or
    has no neighbors (a twin there is an island, not redundancy).
  - **Scan for single points of failure.** Flow lets you pull one device at a time;
    this pulls *every* device at once. "Scan for single points of failure" (⌘K) runs
    the same blast-radius engine across the whole topology and selects every device
    whose loss would isolate something else — worst first — with a one-line verdict
    ("2 single points of failure — worst: Core isolates 5"), or "No single points of
    failure — every device has a backup path" when the design is already resilient.
    Failure-finding goes from a manual hunt to an exhaustive answer; each weak device
    it selects is one "Add a redundant twin" away from fixed.
  - **Harden the design (the capstone).** The one-move version of the whole resilience
    loop: "Harden the design" (⌘K) scans for every single point of failure and adds a
    redundant twin to each *internal* one — wiring every twin to its original's
    neighbors — in a single undoable step, so one ⌘Z reverts the lot. Rescan afterward
    and you're at zero. It's honest about its limits: external nodes (an ISP, a cloud)
    are never silently duplicated — a second provider is a real decision with a
    contract behind it, so hardening leaves them and says so ("the internet/cloud
    uplink is still a single point of failure — add a second provider deliberately").
    Twins land unaddressed, ready for auto-address; "Nothing to harden" when the design
    is already resilient.
  - **Assign gateways to subnets.** Finishes the gateway story. Auto-address and
    segment already set a gateway on the subnets they create; this closes the same
    loop on subnets you drew by hand or imported. "Assign gateways to subnets" (⌘K)
    walks every gateway-less subnet and, when exactly one addressed router or firewall
    sits inside its CIDR, adopts that device's IP as the gateway — one undoable step
    that clears the honest "subnet has no gateway" warning truthfully. Never overwrites
    a gateway you set, and refuses the ambiguous case (zero or several in-range L3
    devices), leaving the warning so you decide.
  - **Resolve duplicate IP addresses.** The error a paste, a clone, or an import
    leaves behind — and the one auto-address never touches, since it only fills blanks.
    "Resolve duplicate IP addresses" (⌘K) finds every address shared by more than one
    device, keeps one, and re-addresses the rest to free hosts in the subnet that
    contains the clash — one undoable step that clears the duplicate-IP error. Same
    allocator as everything else (never collides, skips the gateway), and honest about
    its reach: a clash whose address falls in no defined subnet is left flagged rather
    than re-homed into a range Conductor would have to invent.
  - **Draw subnets to cover orphan addresses.** The other side of addressing: you
    have IPs that sit outside every subnet you've drawn (an import, a hand-typed
    address). "Draw subnets to cover orphan addresses" (⌘K) adds the natural /24 for
    each — one subnet per distinct /24, covering several addresses at once — clearing
    the "not within any defined subnet" warning. It's the one move that picks a prefix
    rather than reading one off your model, so it stays careful: the address itself
    fixes the network, only the /24 boundary is a convention, and it refuses to draw a
    /24 that would overlap a subnet you already have, leaving that address flagged
    instead. New subnets come gateway-less (run "Assign gateways" to adopt one).
  - **Resolve duplicate device names.** The sibling to the address fix. "Resolve
    duplicate device names" (⌘K) finds every name shared by more than one device,
    keeps the first, and numbers the rest ("Core" → "Core 2", "Core 3") — one
    undoable step that clears the duplicate-name warning. It matches the validator
    exactly, grouping and numbering case-insensitively, so it never clears one
    clash by minting another; blank names are left for the separate "no name" nudge.
  - **Resolve duplicate VLAN IDs.** The VLAN sibling, and the last error-severity
    gap in the catalog. Two VLANs on the same 802.1Q ID is a hard error — a paste or
    import will do it. "Resolve duplicate VLAN IDs" (⌘K, or the per-issue **Resolve**
    button) keeps the first and moves the rest to the next free valid ID (1–4094) in
    one undoable step, never reusing a number already live on the board. It fixes only
    the duplication: a group colliding on an out-of-range number (two VLANs at 0) still
    leaves one there — that's the separate invalid-range error, with no safe auto-guess.
- **A command palette that knows what you can do.** The ⌘K commands that need a
  selection — weave into a fabric, wire to a hub, segment into a subnet, add a
  redundant twin — no longer fire into a "nothing happened" flash when the selection
  isn't right. They stay listed (so you learn they exist) but show dimmed, with the
  reason in place of the shortcut ("select 2+", "select one device"), and light up
  the moment the selection qualifies. The keyboard highlight skips the dimmed rows, so
  arrow-and-Enter only ever lands on a command that will actually run.
- **The palette reads as a menu, not a wall.** With the command list past thirty
  entries, opening ⌘K now groups them under section headers — Build, Connect, Address,
  Resilience, Repair, Edit, View, File — so you can scan to the kind of thing you want
  instead of down one long list. Start typing and the sections fall away for a flat,
  ranked fuzzy match across everything, exactly as before. The keyboard walks the
  grouped order top-to-bottom, so arrow-and-Enter follows what you see.
- **Conductor suggests, right where you act.** Open ⌘K and the palette now leads with
  a **Suggested** section: the fixes that would actually change your design right now,
  each with a live count — "Resolve 3 duplicate IP addresses", "Draw 2 subnets to
  cover orphan addresses", and a "Fix all N safe issues" to do them in one move. A fix
  that has nothing to do stays quietly under Repair in its plain form — no counts, no
  false urgency. The suggestions are computed by dry-running the same planners the
  fixes use, so the number you see is exactly what the command will do; nothing is
  mutated to find out. It turns the palette from a list of everything into Conductor
  looking at your design and telling you what it would fix.
  - **Prune dangling links.** The other hard error — a link that points at a device
    that isn't there. You can't draw one (deleting a device takes its links with it);
    it only rides in on a hand-edited or externally generated `.nexmap`. "Prune
    dangling links" (⌘K) removes every link with a missing endpoint in one undoable
    step, clearing the error, and leaves the links that connect two real devices alone.
  - **Clear dangling interface references.** The last one NexMap flags. A link can
    carry a reference to a specific port that an import left pointing at an interface
    the device no longer has (you can't cause it in the editor — removing a port
    cascades its links clear). "Clear dangling interface references" (⌘K) drops just
    the stale pointer and keeps the link, clearing the warning. A link whose whole
    *device* is missing is left for "Prune dangling links" instead, so the two
    cleanups never fight over the same link.
  - **Name unnamed devices.** The small, friendly one. "Name unnamed devices" (⌘K)
    gives every blank device a sensible label from its type ("Switch", "Server"),
    numbered so the batch stays distinct ("Switch", "Switch 2") and never collides
    with a name already on the board — clearing the no-name warning without ever
    creating a duplicate-name one. Devices you've already named, however oddly, are
    left alone; naming is your call, and this only fills true blanks.
  - Along the way, Flow's blast-radius engine learned that a load balancer is an
    ingress, and that an egress-less redundant fabric (dual ToR, dual core) has
    *two* cores, not one — so failing one twin no longer reads as a total outage.
- **Stress-test your design (Flow lens).** A read-only "Flow" mode (toolbar TEST
  toggle, Esc to exit) turns the network canvas into a what-if instrument: click
  any device to pull it and watch the blast radius cascade red along the links to
  everything that loses its path to the network, while a one-line verdict reads
  "N devices isolated" or the green "Holding — 0 devices lost." And survivors
  **reroute**: the full backup path that now carries their traffic to the egress
  lights up cyan against the red death, with the verdict naming it ("rerouted
  over N backup links"). Click again to restore. Honest reachability over the
  drawn graph (not routing), reusing the SPOF/bridge health engine; pure, O(V+E),
  unit-tested. The first time the motion answers a question instead of
  decorating one.
- **The NexMap Deck — a reimagined, command-first entry experience.** The plain
  two-card chooser is now a cinematic hub: a real-time 3D "network constellation"
  rendered on a dependency-free canvas (DPR/visibility/reduced-motion aware), a
  bespoke animated brand mark, hand-built isometric illustrations for each
  designer, and a ⌘K-style quick-launch you can drive from the keyboard. The
  tested contract is unchanged (the `Choose a designer` dialog and the
  `Network Designer` / `Rack Designer` entry points still route exactly as before).
- **A bundled motion reel.** A rendered, seamless-looping 3D network reel ships
  as a local VP8 `.webm` (+ poster) — no CDN, no runtime network. Reachable from
  the Deck ("See NexMap in motion") and embedded in the About dialog; it never
  autoplays under reduced-motion.
- **Self-hosted type system.** Inter, Space Grotesk and JetBrains Mono ship as
  latin-subset variable `woff2` (SIL OFL), applied to hero/overlay surfaces,
  brand, and metrics chips. The dense editor chrome stays on the system stack so
  its tested geometry is byte-for-byte unchanged.
- **Living signal flow.** Every network link carries bright "packets" that
  march source→target, health-colored (cyan when healthy, amber/red on a
  critical bridge or conflict, accent when selected) and phase-offset per link
  so the field shimmers out of phase instead of in lockstep. The rack editor's
  patched cables carry matching light-packets. Compositor-cheap (animated
  `stroke-dashoffset`, no per-frame JS, no filters in the hot path).
- **Magnetic connect gesture.** Dragging a new link paints a glowing, gently
  bowed cable with flowing packets, a start dot, and a pulsing reticle that
  snaps onto valid targets; drop-target nodes breathe with an accent glow and
  selected nodes glow.
- **Living hardware.** Device icons, flat and isometric, now read as powered
  gear: status lights are real activity LEDs that pulse (health-hued, staggered
  out of phase, amber/red blinking faster and deeper), every device carries a
  faint device-family "powered" under-glow, and the displays on monitors, VMs
  and printer panels glow with a sweeping scanline.
- **Living motion control** (Settings → Living motion): `full` (the designed
  experience), `subtle` (gentle breathing only, no traveling packets or
  scanlines), or `off` (static diagram, ordinary UI transitions unaffected).
  Persists locally and applies via `<html data-motion>`; the Reduced motion /
  `prefers-reduced-motion` accessibility switch still overrides everything.

### Changed

- **A cohesive, dark-first design system.** A greatly expanded token set
  (layered surfaces, brand gradients, elevation, glow, radii, spacing, motion
  curves, z-index) restyles the whole app — topbar, panels, status bar, command
  palette, first-run, dialogs, and the device library — in both light and dark,
  with GPU-friendly micro-interactions throughout. The local-first CSP + netguard
  guarantees are untouched.
- Refreshed brand assets: new app icon, Open Graph image, and theme color.

### Fixed

- **Declaring a rule is autosaved right away.** Autosave only watched for diagram
  edits, and declaring, retracting, adding or removing a rule doesn't edit the diagram.
  So a rule-only change wasn't written to the draft until you next touched the canvas.
  Close the tab before that, and the rule was gone on recovery. Autosave now also fires
  when the declared rules change.
- **The Rules panel's "N rules declared" count includes custom rules**, so it no longer
  reads "0 declared · 1 not met".
- **Redundant twins of an unnamed device get a real name.** Twinning a device with a
  blank name (via "Add a redundant twin", "Harden the design", or restoring the no-SPOF
  rule) produced a twin named "" or " 2". Twins of an unnamed device are now named from
  their type ("Switch 2").
- **E2E CI.** Pinned the Playwright E2E job to `ubuntu-24.04`. `ubuntu-latest`
  had rolled to 26.04, where Playwright can't install Chromium
  (`does not support chromium on ubuntu26.04-x64`), reddening every run.

## [0.6.2] - 2026-07-05

The pointer-native canvas release: both designers' input layers were rebuilt
from scratch on one shared gesture engine, then hardened by a seven-reviewer
audit. 33 commits; suite at 669 unit tests and 58 end-to-end specs.

### Added

- **One gesture engine for every canvas.** All pointer work on the network
  designer, the rack editor, and the multi-rack row view now runs on a single
  pure state machine (`src/input/`): identical 4px click-vs-drag feel at every
  zoom level, Escape always cancels cleanly, and interrupted gestures (OS
  popups, window switches, lost pointer capture) can never leave the canvas
  stuck. Proven by a 3000-sequence fuzz harness.
- **Touch and tablet support everywhere.** Two-finger pinch zooms at your
  fingers, two-finger drag pans, a second finger mid-drag safely cancels into
  a pinch — and lifting one finger from a pinch continues as a smooth
  one-finger pan. Works on all three canvases.
- **Quick-create.** Double-click empty canvas to place a device from a compact
  picker; drop a connection on empty space to create AND wire the new device
  in one motion (one undo entry). In the rack, double-click an empty bay to
  repeat the last-used preset.
- **Cross-rack drag in the row view.** Grab gear and drag it onto another
  cabinet with a live drop preview that tells the truth: green when the span
  fits at that U, amber naming the actual landing U when it doesn't.
- **Click-click cabling** in the rack editor: tap one jack, tap another —
  the low-dexterity alternative to drag-to-cable, gated on the same
  connect-mode preference as the flat canvas.
- **Quiet canvas.** A floating selection toolbar is now the primary quick-
  action path on both designers (align/distribute, z-order, group, nudge,
  unmount, cable editing at the cable itself); idle chrome gently fades to
  80% after you start working and wakes on hover, tap, or keypress.
- **Unified wheel contract.** Plain scroll pans, Ctrl/pinch zooms at the
  cursor — the same on every canvas, flippable in Settings. Returning rack
  users get a one-time toast (their wheel used to zoom).

### Changed

- Pan/zoom is now a pure CSS transform on every canvas: scenes (device art,
  rack shells, cables, minimap dots) are memoized and no longer re-render per
  frame — pinned by render-count perf tests on all three canvases.
- Rejected rack drops always flash the slot, name the reason, and pulse the
  nearest free U; screen-reader users hear the same announcements.
- Accessibility: real one-Tab-stop toolbar with roving focus, keyboard-
  reachable rack reorder buttons, focus returns to the canvas when menus
  close, cable color swatches announce names ("green"), readable contrast on
  drop-preview labels and quiet chrome.

### Fixed

- A stray release from a second pointer (touch + pen/mouse) could resolve an
  armed press as a phantom click and orphan the real gesture.
- An Escape-cancelled bend drag left a hidden no-op history entry that
  silently ate the next undo; quick-create-with-connection was two undo
  entries (one undo stranded an orphan device). Both are now exactly one.
- Keys no longer leak through the open quick-create picker to the canvas
  behind it (Delete could destroy the selection while picking).
- Rail-mounted gear (0U PDUs) was falsely rejected when moved into a full
  rack; double-clicking the rack zoom buttons could mount gear behind them;
  wheel-panning under an open picker shifted where the device landed.
- Cancelled drags no longer mark a freshly saved document as edited.


### Fixed

- **Rack canvas pan/zoom no longer steals clicks (v0.6.1).** Capturing the pointer on
  press retargeted the subsequent click to the canvas, so clicking a rack to drill in (or
  selecting gear) silently stopped working in the row view. The pointer is now captured
  only once an actual pan drag begins, so plain clicks reach the rack again. Caught by the
  multi-rack e2e.

### Added

- **Rack canvas navigation + A/B power (v0.6.0).**
  - **Pan + zoom** on the multi-rack canvas: wheel-zoom anchored to the cursor, drag-to-pan,
    fit-to-screen, and a zoom control cluster. The canvas no longer just scrolls — large
    fleets are navigable. (Crisp vector zoom via an SVG transform.)
  - **A/B power feeds.** Each device cords into feed A, B, or A+B (redundant PSUs); the
    fleet capacity strip shows per-feed load (`⚡ A x · B y kW`) and flags single-corded
    devices that have no power redundancy. Per-feed failover load is modeled too (what each
    feed must carry if the other dies).

- **Rack Designer Pro — power, planning, and at-a-glance ops (v0.5.0).** A big batch of
  rack-designer upgrades:
  - **Realistic power/weight budgets.** Every device now carries nominal watts + weight, so
    the per-rack and new **fleet capacity strip** (`N racks · used/total U · free % · kW · kg`)
    read real numbers instead of 0. UPS/PDU correctly count as power sources.
  - **Pre-made templates.** Quick-start from 7 designs grouped Home / Office / Enterprise
    (wall lab, media+NAS, office IDF, server room, enterprise core/compute/edge) — picker in
    the empty state and a **Templates** toolbar button; applying one appends a fully-built,
    named rack in a single undo.
  - **Named vendor catalog.** ~32 real models (Cisco, Arista, Juniper, Dell, HPE, Palo Alto,
    Fortinet, Synology, APC, …); the inspector's **Hardware model** picker auto-fills
    vendor/model/power/weight.
  - **Per-port VLAN tagging** with a VLAN-mismatch health check and a VLAN column in the
    cable schedule (CSV + on-canvas table).
  - **Auto cable length** estimated from rack geometry (vertical U + cross-rack travel +
    slack, rounded to a stocked length) — one-click fill for every cable without a length.
  - **Lifecycle + asset tracking.** Device status (planned / active / maintenance /
    decommissioned) with a status tint on the gear, plus serial / asset tag / owner /
    warranty fields.
  - **Occupancy heatmap** — a per-U used/free track on each rail.
  - **Color-by-attribute** — tint the whole fleet by status or owner, with a legend.
  - **Opposite-face ghosts** — a full-depth chassis (switch/server/firewall/UPS) now shows a
    muted back-of-chassis ghost on the opposite face and blocks the same U on both faces;
    shallow gear (patch/blank) can still share a U front-to-back.
  - **Rear-specific port art** — the rear of full-depth gear renders PSUs + fan grilles, not
    a mirror of the front jacks.
  - **Printable label sheet** export — a cut-out label per device (name, rack/U, model).

- **Rack Designer v3 — default side-by-side canvas + realistic gear.** The designer now
  opens straight into the multi-rack canvas: every rack shown next to the others with
  **both faces (front + rear) side by side**, a **Hide rear** toggle, and `+ Rack` dropping
  a new cabinet in place. Click a rack to drill into the detailed port editor; "← All racks"
  returns. Every device is redrawn realistically (Studio Realism): switches with real RJ45
  jacks, link/activity LEDs, and SFP+ cages; patch panels with numbered keystone ports;
  servers with drive bays, status LCD, and power button; PDUs with outlets; brushed-metal
  faceplates with a glossy sheen. One shared renderer (`rackDeviceArt.ts`) drives the live
  editor, the canvas, and the PNG/PDF export identically — gradients survive rasterization.

- **Rack Designer** — a separate designer screen, chosen at launch (Network vs
  Rack). Drag switches, servers, firewalls, patch panels, PDUs and more into a
  cabinet at any U; front/rear faces; full- and half-bay placement; 0U rail gear.
  Port-to-port cabling with color-coded, labeled connectors and an installer
  cable-schedule. Export the elevation to PNG/PDF and the schedule to CSV.
  Auto-numbered device names, inline rename, keyboard nudge/delete, and an
  invalid-drop rejection hint. Everything runs locally — no login, no server.
  `.nexmap` schema migrated v2 → v3 (additive, round-trip-safe).
- **Rack Designer v2 — multi-rack + cross-rack cabling + validation + table export.**
  A new **Row view** shows every rack side by side in one canvas; click a rack to
  focus and edit it, reorder cabinets, and move a device to another rack. Cables can
  now span racks. A **cabling-health** panel warns (never blocks) on physical loops
  (spanning-tree), single points of failure, bridge cables, speed/media mismatches,
  and cross-rack sanity — reusing the network designer's graph engine on the physical
  cable graph. A **connections table** is shown in-app and export now offers three
  modes (diagram, diagram + table, or table only) for PNG/PDF. Plus a per-rack
  **power/weight + U-utilization budget** with overload warnings, one-click **rack
  clone** (gear + intra-rack cabling), and **cross-rack device search**. All additive
  to schema v3 — no version bump, old files load unchanged.
- Flat 2D device-model icons (detailed, per-type) distinct from the 3D
  isometric models; the library palette and flat-mode export track the active
  projection.
- FossFLOW-style floating info card above nodes (name + sanitized rich-text
  description) with a dotted leader; on-canvas inline rename.
- 2D vs ISO visual differentiation: grounded shadows in iso (flat stays flat),
  an iso stage vignette, cable-on-floor connector shadows, and an animated tilt
  on projection toggle.
- Positioned vendor/model/role combobox; per-node icon-size and label-height
  controls.
- 18 grouped starter templates (Home & small office, Enterprise & data center).
- Group move carries a connector's waypoints when both endpoints move.
- Cloudflare Workers + Pages deployment config (`wrangler.toml`, `_headers`,
  deploy scripts); live at https://nexmap.xyz.
- Generated README/social visuals from the export pipeline
  (`npm run gen:readme-media`) including a 1200×630 Open Graph card.
- Continuous Integration (GitHub Actions): lint, test, build, and Cloudflare
  config validation on every PR and push to `main`.
- Project governance: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  issue/PR templates.

### Fixed

- Info card no longer swallows connector clicks (foreignObject is click-through).
- Vendor/model/role dropdown now anchors correctly under its input.
