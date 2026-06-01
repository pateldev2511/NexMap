# NexMap — Deferred Work (Post-MVP)

Logged during `/autoplan` review. These are out of MVP scope by decision, not omission.

## Post-MVP features
- [ ] Rack elevation mode (front/rear, RU collision, patch panels, cable tracing)
- [ ] Cloud objects + cloud-specific validations (VPC/VNet, gateways, route tables, SGs)
- [ ] Advanced auto-layout / topology auto-arrange
- [ ] Multi-view projects (overview, physical, logical, rack, site, security, cloud, IP plan)
- [ ] Full `interfaces[]` layer (MVP links connect devices with optional iface label only)
- [ ] Discovery imports — the real "document existing infra" wedge expansion:
  - [ ] Nmap XML, LLDP/CDP exports (highest wow: scan → validated topology)
  - [ ] NetBox CSV/JSON, GraphML, draw.io XML, Terraform, Visio VSDX
- [ ] Wireless coverage planning / AP placement on floor plans
- [ ] Project diffing / compare two `.nexmap` files
- [ ] Presentation mode, read-only preview mode
- [ ] Zip export package (project + images + PDFs + CSVs)

## Post-MVP technical (multi-week, explicitly deferred by Eng review)
- [ ] Connector obstacle-avoidance routing (A*/visibility-graph) — MVP = straight + simple elbow
- [ ] Multi-page PDF tiling + inventory/IP-plan/validation appendices — the real MSP handoff artifact, do it properly
- [ ] Canvas-2D static render layer behind SceneSource (only if M0 perf harness fails the bar)

## Validation backlog (Post-MVP, beyond the 4 MVP checks)
- [ ] Overlapping subnets, duplicate VLAN ID in scope, missing gateway, trunk missing VLANs,
      access port multiple untagged, rack unit collision, orphaned devices, circular deps,
      link bandwidth mismatch, zone missing classification

## Premise validation (do before/alongside M2 — CEO review)
- [ ] Validate premise: network engineers want no-login local (interviews / landing smoke test)
- [ ] Validate premise: live validation is switch-worthy (the wedge bet)
- [ ] Decide on opt-in, local-by-default feedback mechanism (privacy-preserving learning loop)
