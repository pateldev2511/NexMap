# Project NexMap

## Purpose

Project NexMap is a local-first browser web app for designing, documenting, validating, importing, and exporting network infrastructure diagrams. It is intended for network engineers, infrastructure designers, MSPs, lab builders, students, and IT teams who need a fast visual design workspace without accounts, cloud storage, or a required backend.

The app should open directly in a user's browser, run locally, and keep project data on the user's machine unless the user explicitly exports or imports a file.

## Core Principles

- No login, no accounts, no user profiles, and no cloud dependency.
- Works offline after the app is loaded.
- User owns all project files and exported assets.
- Designs should be portable, inspectable, and recoverable.
- The canvas should support both polished presentation diagrams and technical infrastructure planning.
- The app should scale from a simple home network to large enterprise and data center layouts.
- Import and export should be first-class features, not afterthoughts.
- Every important action should be reversible where possible.

## Target Users

- Network infrastructure designers creating LAN, WAN, WLAN, firewall, cloud, and data center layouts.
- IT administrators documenting existing infrastructure.
- MSPs preparing client network diagrams and handoff documents.
- Security engineers planning segmentation, trust zones, and firewall paths.
- Lab users designing virtual environments.
- Students learning network topology concepts.

## No-Login Local Browser Model

NexMap should not require authentication. All app state should be stored locally through browser-supported storage and file APIs.

Recommended local storage strategy:

- IndexedDB for autosaved projects, large project data, imported images, and recent workspace state.
- Local Storage only for small preferences such as theme, grid setting, and panel layout.
- File System Access API where supported, so users can open and save `.nexmap` files directly.
- Download fallback for browsers that do not support direct local file writes.
- Optional backup export reminder for users who rely only on browser storage.

Important local-only behavior:

- The app must never silently upload projects, imported files, telemetry, or exported diagrams.
- If optional telemetry is ever added, it must be disabled by default and clearly explained.
- Browser cache clearing may delete local autosaves, so the app should warn users and encourage project file exports.
- Private/incognito windows may lose local data after closing, so the app should show a clear local-storage warning.

## Main App Layout

### Top Bar

The top bar should contain global project actions and status.

Required controls:

- App name and current project name.
- New project.
- Open or import.
- Save.
- Save as `.nexmap`.
- Export.
- Undo and redo.
- Search.
- Presentation mode.
- Validation status.
- Autosave status.
- Zoom percentage.
- Theme toggle.
- Help or keyboard shortcuts.

Expected behavior:

- Project title should be editable inline.
- Unsaved changes should be visibly indicated.
- Destructive actions such as New Project should prompt if there are unsaved changes.
- Save should write to the current file when possible or download a `.nexmap` file as fallback.

### Left Sidebar: Object Library

The left sidebar should provide draggable network components.

Device categories:

- Routers.
- Switches.
- Firewalls.
- Wireless access points.
- Wireless controllers.
- Servers.
- Storage.
- Load balancers.
- End-user devices.
- Printers and IoT devices.
- ISP or internet nodes.
- Cloud providers.
- Virtual machines.
- Containers.
- Racks.
- Patch panels.
- UPS and power devices.
- Cameras and physical security devices.
- Generic node.
- Text note.
- Shape.
- Image.
- Group or container.

Network zones:

- LAN.
- WAN.
- DMZ.
- Guest network.
- Management network.
- Voice network.
- Storage network.
- Production.
- Staging.
- Development.
- Cloud VPC or VNet.
- Branch office.
- Data center.

Library behavior:

- Components should be searchable.
- Users should be able to favorite common components.
- Users should be able to create custom device templates.
- Recently used components should be shown.
- Dragging a component to the canvas should create a sensible default object with editable properties.

### Center: Design Canvas

The canvas is the primary workspace.

Required canvas features:

- Pan.
- Zoom.
- Select.
- Box select.
- Drag and drop.
- Multi-select.
- Snap to grid.
- Snap to object.
- Alignment guides.
- Auto-layout.
- Manual layout.
- Copy, paste, duplicate, delete.
- Lock and unlock objects.
- Hide and show objects.
- Group and ungroup.
- Bring forward and send backward.
- Layers.
- Minimap.
- Fit to screen.
- Zoom to selection.
- Infinite or very large canvas.
- Page boundaries for printable exports.

Canvas modes:

- Select mode.
- Connect mode.
- Text mode.
- Shape mode.
- Area or zone mode.
- Rack layout mode.
- Presentation mode.
- Read-only preview mode.

Canvas visual options:

- Grid on or off.
- Grid size.
- Light and dark theme.
- Page size overlay.
- Device labels on or off.
- Interface labels on or off.
- IP labels on or off.
- VLAN labels on or off.
- Link bandwidth labels on or off.
- Health or validation overlay.
- Physical layout view.
- Logical topology view.
- Security zone view.
- VLAN view.
- Cloud view.

### Right Sidebar: Properties Inspector

The right sidebar should show editable properties for the selected item.

For devices:

- Name.
- Device type.
- Vendor.
- Model.
- Role.
- Location.
- Rack.
- Rack unit position.
- Management IP.
- Hostname.
- Serial number.
- Asset tag.
- Operating system or firmware.
- Notes.
- Tags.
- Icon style.
- Fill color.
- Border color.
- Label visibility.
- Custom metadata fields.

For links:

- Link name.
- Source device.
- Source interface.
- Destination device.
- Destination interface.
- Link type.
- Cable type.
- Media type.
- Bandwidth.
- VLANs carried.
- Native VLAN.
- LACP or port-channel group.
- Trunk or access mode.
- IP subnet.
- Routing protocol.
- Firewall rule reference.
- Label style.
- Direction arrows.
- Redundancy role.
- Notes.

For zones or containers:

- Zone name.
- Zone type.
- Description.
- Color.
- Boundary style.
- Default VLAN.
- Default subnet.
- Security classification.
- Nested objects.

Inspector behavior:

- Single selection shows full details.
- Multi-selection shows common editable fields.
- Empty selection shows project-level properties.
- Invalid fields should show clear inline errors.
- Changes should be undoable.

### Bottom Panel

The bottom panel should be collapsible and support technical detail views.

Recommended tabs:

- Inventory.
- IP plan.
- VLANs.
- Links.
- Validation.
- Change log.
- Export log.
- Import results.

Inventory table columns:

- Name.
- Type.
- Vendor.
- Model.
- Role.
- Location.
- IP address.
- VLANs.
- Tags.
- Notes.

IP plan table columns:

- Subnet.
- CIDR.
- Gateway.
- VLAN.
- Zone.
- DHCP range.
- Reserved addresses.
- Used addresses.
- Conflicts.

VLAN table columns:

- VLAN ID.
- Name.
- Zone.
- Subnet.
- Tagged links.
- Untagged ports.
- Notes.

Links table columns:

- Link name.
- Source.
- Source interface.
- Destination.
- Destination interface.
- Type.
- Bandwidth.
- VLANs.
- Status.

## Main Features

### Project Management

- Create a blank project.
- Create from template.
- Open `.nexmap` files.
- Save `.nexmap` files.
- Save a copy.
- Autosave local drafts.
- Recover unsaved local drafts.
- Project rename.
- Project metadata.
- Recent projects.
- Duplicate project.
- Clear local project data.

Templates should include:

- Small office network.
- Home lab.
- Branch office.
- Multi-site WAN.
- Data center rack.
- Cloud VPC or VNet.
- Firewall segmentation.
- Campus network.
- Wireless deployment.

### Diagramming

- Drag devices onto canvas.
- Connect devices with links.
- Draw zones and boundaries.
- Add labels and notes.
- Add legends.
- Add title blocks.
- Add images or floor plans as underlays.
- Create reusable groups.
- Create custom symbols.
- Apply themes.
- Align and distribute objects.
- Auto-arrange topology.
- Route connector lines around objects.
- Support straight, elbow, curved, and freeform links.
- Support link bundles and redundant paths.

### Network Semantics

NexMap should understand network-specific meaning instead of being only a drawing tool.

Required semantic entities:

- Device.
- Interface.
- Link.
- VLAN.
- Subnet.
- IP address.
- Zone.
- Site.
- Rack.
- Cloud network.
- Firewall rule reference.
- Route reference.
- Dependency.

Useful validations:

- Duplicate IP address.
- Invalid CIDR.
- IP outside subnet.
- Duplicate VLAN ID in the same scope.
- Missing gateway.
- Link without source or destination interface.
- Interface connected to more links than allowed.
- Trunk link missing VLANs.
- Access port with multiple untagged VLANs.
- Overlapping subnets.
- Device without a name.
- Device without a type.
- Circular dependency warnings where relevant.
- Zone missing classification.
- Rack unit collision.
- Link bandwidth mismatch.
- Orphaned devices.
- Hidden objects included in export warning.

### Search and Navigation

- Search devices, IPs, VLANs, subnets, tags, notes, interfaces, and links.
- Search results should jump to objects on canvas.
- Filters by type, tag, zone, site, VLAN, subnet, and validation issue.
- Breadcrumbs for nested groups or sites.
- Minimap for large diagrams.
- Keyboard shortcut to focus search.

### Layers and Views

Layers should let users organize complex designs.

Example layers:

- Physical.
- Logical.
- Wireless.
- Security.
- Cloud.
- Cabling.
- IP addressing.
- Notes.
- Floor plan.
- Rack elevation.

Layer behavior:

- Show or hide layer.
- Lock layer.
- Rename layer.
- Reorder layer.
- Export only selected layers.
- Import into a selected layer.
- Warn before deleting a layer with objects.

Views should let one project contain multiple diagram perspectives.

Example views:

- Overview.
- Physical topology.
- Logical topology.
- Rack view.
- Site view.
- Security zones.
- Cloud architecture.
- IP plan.

### Rack and Physical Layout

Rack-specific features:

- Add racks with configurable RU height.
- Place devices in rack units.
- Detect rack unit collisions.
- Support front and rear views.
- Patch panel representation.
- Cable tracing between rack devices.
- Power device placement.
- Device depth notes.
- Rack elevation export.

Physical layout features:

- Import floor plan image.
- Set scale.
- Place devices on floor plan.
- Wireless AP placement.
- Cable path drawing.
- Room, closet, and site labels.

### Cloud and Hybrid Network Design

Cloud objects:

- VPC or VNet.
- Subnet.
- Internet gateway.
- NAT gateway.
- Route table.
- Security group.
- Network ACL.
- VPN gateway.
- Direct connect or express route.
- Load balancer.
- Virtual machine.
- Kubernetes cluster.
- Managed database.
- Object storage.

Hybrid features:

- On-prem to cloud links.
- VPN tunnel labels.
- BGP ASN fields.
- Route advertisement notes.
- Redundant tunnel display.
- Region and availability zone grouping.

### Collaboration Without Login

Because the app has no login, collaboration should happen through files.

Supported collaboration methods:

- Share `.nexmap` project files.
- Export read-only PDF.
- Export image files.
- Export SVG for editing elsewhere.
- Import another `.nexmap` file into the current project.
- Compare imported project with current project.

Optional local-only collaboration helpers:

- Project change log.
- Author name stored locally as optional project metadata.
- Manual version notes.
- Export package with all images and data.

## Import Requirements

NexMap should have a proper import flow with preview, mapping, validation, and rollback.

### Import Entry Points

- Top bar Import button.
- Drag and drop files onto canvas.
- Paste image or SVG from clipboard.
- Import into current project.
- Open as new project.
- Import into selected layer or view.

### Native Import

The main project format should be `.nexmap`.

`.nexmap` should contain:

- Project metadata.
- Canvas objects.
- Links.
- Views.
- Layers.
- Device inventory.
- IP plan.
- VLAN table.
- Custom symbols.
- Imported images.
- Validation state.
- App version.
- Schema version.

Recommended format:

- JSON-based file for easy recovery and debugging.
- Optionally packaged as a zip if embedded images become large.
- Include `schemaVersion` and migration support.

### Supported Import Formats

Required:

- `.nexmap` native project file.
- `.json` structured NexMap-compatible data.
- `.csv` device inventory.
- `.csv` link inventory.
- `.csv` IP plan.
- `.csv` VLAN list.
- `.svg` diagram or symbol import.
- `.png`, `.jpg`, `.jpeg`, and `.webp` as background images or image objects.

Strongly recommended:

- `.drawio` or diagrams.net XML import.
- `.graphml` topology import.
- `.yaml` or `.yml` structured project import.
- Clipboard image import.
- Clipboard SVG import.

Optional future imports:

- Visio `.vsdx` import.
- Terraform plan or state network extraction.
- Cloud provider inventory exports.
- Nmap XML.
- NetBox CSV or JSON.
- LLDP/CDP discovery exports.

### Import Flow

1. User selects or drops a file.
2. App detects file type.
3. App scans basic structure.
4. App shows import preview.
5. User chooses import mode:
   - Replace current project.
   - Merge into current project.
   - Add as new view.
   - Add as new layer.
   - Add as image underlay.
6. User maps columns or fields when needed.
7. App validates imported content.
8. User reviews warnings.
9. User confirms import.
10. App creates an undo checkpoint.
11. Import is applied.
12. Import summary appears in the bottom panel.

### CSV Import Mapping

CSV imports should support flexible headers.

Device CSV possible columns:

- name.
- hostname.
- type.
- role.
- vendor.
- model.
- location.
- site.
- rack.
- ru.
- management_ip.
- vlan.
- zone.
- tags.
- notes.

Link CSV possible columns:

- name.
- source.
- source_interface.
- target.
- target_interface.
- type.
- bandwidth.
- vlan.
- native_vlan.
- allowed_vlans.
- subnet.
- notes.

IP plan CSV possible columns:

- subnet.
- cidr.
- gateway.
- vlan_id.
- vlan_name.
- zone.
- dhcp_start.
- dhcp_end.
- reserved.
- notes.

Mapping requirements:

- Auto-detect common header names.
- Let users manually map columns.
- Show unmapped columns.
- Let users ignore columns.
- Preserve unknown fields as custom metadata if the user chooses.
- Detect duplicate names and offer rename, merge, or skip.

### Import Edge Cases

The import system must handle:

- Empty files.
- Unsupported file extensions.
- Incorrect file extension with valid content.
- Corrupt JSON.
- Malformed CSV rows.
- CSV with quoted commas.
- CSV with different delimiters.
- CSV with UTF-8 BOM.
- Duplicate device names.
- Duplicate IP addresses.
- Duplicate VLAN IDs.
- Missing required columns.
- Unknown device types.
- Unknown link endpoints.
- Links imported before devices.
- Very large files.
- Images too large for browser memory.
- SVG with scripts or unsafe content.
- External image references inside SVG.
- Imported coordinates outside visible canvas.
- Negative coordinates.
- Extremely long labels.
- Mixed units.
- Invalid CIDR values.
- IPv4 and IPv6 mixed data.
- Timeouts during parsing.
- Browser storage quota limits.
- User cancels during import.

Import safety:

- Never execute imported SVG scripts.
- Strip unsafe SVG content.
- Do not fetch remote references from imported files unless user explicitly allows it.
- Import should be transactional: failed imports should not corrupt the current project.
- User should be able to undo a completed import.

## Export Requirements

Export must support JPG, PNG, SVG, and PDF as required formats.

### Export Entry Points

- Top bar Export button.
- Keyboard shortcut.
- Context menu for selected objects.
- Export from view menu.
- Export from layer menu.

### Required Export Formats

PNG export:

- Transparent background option.
- Solid background option.
- Scale options such as 1x, 2x, 3x, 4x.
- Export entire canvas, current viewport, selected objects, selected view, or page area.
- Preserve crisp text where possible.

JPG export:

- Background color required because JPG has no transparency.
- Quality slider.
- Scale options.
- Export entire canvas, viewport, selection, view, or page area.

SVG export:

- Export vector shapes, lines, labels, symbols, and embedded images.
- Option to outline text or keep text editable.
- Option to include metadata.
- Option to include or exclude hidden layers.
- Sanitize exported SVG.
- Preserve object IDs where useful.

PDF export:

- Page size selection: Letter, Legal, A4, A3, custom.
- Orientation: portrait or landscape.
- Margins.
- Fit to page.
- Actual size.
- Multi-page tiling for large diagrams.
- Export selected views as multiple PDF pages.
- Include title block.
- Include legend.
- Include inventory appendix.
- Include IP plan appendix.
- Include validation report appendix.

Also recommended:

- `.nexmap` project export.
- JSON export.
- CSV export for inventory, links, VLANs, and IP plan.
- Export package as zip containing project, images, PDFs, and CSVs.

### Export Options Panel

The export dialog should include:

- Format selector.
- Export scope.
- View selector.
- Layer selector.
- Page size.
- Orientation.
- Background color.
- Transparent background toggle when supported.
- Scale or DPI.
- Include labels toggle.
- Include hidden layers toggle.
- Include grid toggle.
- Include notes toggle.
- Include title block toggle.
- Include legend toggle.
- Include metadata toggle.
- Filename field.
- Preview.
- Estimated file size.

Export scopes:

- Entire project.
- Current view.
- Current viewport.
- Selected objects.
- Selected layers.
- Printable page area.

### Export Edge Cases

The export system must handle:

- Empty canvas.
- Hidden layers.
- Locked objects.
- Objects outside page bounds.
- Objects with negative coordinates.
- Extremely large canvas.
- Huge background images.
- Transparent backgrounds.
- Browser canvas size limits.
- High DPI exports.
- Missing fonts.
- Text overflow.
- Unsupported image formats inside export.
- Cross-origin image issues.
- SVG embedded raster images.
- Multi-page PDF clipping.
- Very long file names.
- Invalid filename characters.
- Export cancellation.
- Export progress for large diagrams.
- Memory pressure.

Export behavior:

- Warn if output may be clipped.
- Warn if browser limits require reduced scale.
- Offer to export selected area when full canvas is too large.
- Preserve aspect ratio unless user explicitly chooses otherwise.
- Use safe default filenames.
- Never overwrite local files without browser/user confirmation.

## Data Model

Recommended top-level project structure:

```json
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "project": {
    "id": "project-id",
    "name": "Untitled NexMap Project",
    "createdAt": "ISO_DATE",
    "updatedAt": "ISO_DATE",
    "description": "",
    "units": "px"
  },
  "views": [],
  "layers": [],
  "objects": [],
  "links": [],
  "devices": [],
  "interfaces": [],
  "vlans": [],
  "subnets": [],
  "racks": [],
  "assets": [],
  "customFields": []
}
```

Important data requirements:

- Every object should have a stable ID.
- Links should reference object IDs, not names.
- Names can change without breaking connections.
- Custom fields should be preserved through import and export.
- Schema migrations should be supported.
- Unknown future fields should not be deleted during load/save unless unsafe.
- Embedded assets should be deduplicated where possible.

## Validation and Error Handling

Validation should be visible but not blocking unless data would be corrupted.

Validation severity:

- Info.
- Warning.
- Error.
- Critical.

Validation panel should:

- List all issues.
- Filter by severity.
- Jump to affected object.
- Suggest fixes.
- Support ignore or acknowledge for non-critical warnings.
- Re-run automatically after edits.

Critical errors:

- Corrupt project file.
- Unsupported schema version with no migration path.
- Import that would delete existing work without confirmation.
- Export failure due to browser limit.

## Undo, Redo, and History

Required history behavior:

- Undo and redo canvas edits.
- Undo and redo property edits.
- Undo import.
- Undo delete.
- Undo group and ungroup.
- Undo layer changes.
- Create checkpoints before large operations.
- Limit history size to avoid memory exhaustion.
- Clear redo stack after new action.

History edge cases:

- Imported files with many objects.
- Large image changes.
- Repeated drag movements.
- Multi-object edits.
- Autosave during undo.
- Project reload after crash.

## Autosave and Recovery

Autosave should:

- Save local drafts to IndexedDB.
- Show last saved time.
- Debounce frequent changes.
- Avoid blocking canvas interactions.
- Keep recovery snapshots.
- Detect crashed or abandoned sessions.
- Offer recovery on next launch.

Recovery edge cases:

- Browser storage quota reached.
- Autosave partially written.
- Multiple tabs editing the same project.
- User opens an older project file while a newer local draft exists.
- User clears browser data.

Recommended behavior for multiple tabs:

- Detect same project open in another tab.
- Warn user before editing in both tabs.
- Prefer read-only mode in the second tab unless user chooses to continue.

## Performance Requirements

The app should remain usable with:

- 1,000 devices.
- 5,000 links.
- 10,000 interfaces.
- 1,000 VLANs.
- 1,000 subnets.
- Large imported background images.
- Multiple views and layers.

Performance features:

- Canvas virtualization.
- Efficient hit testing.
- Batched rendering.
- Debounced validation.
- Lazy load large panels.
- Avoid re-rendering the entire canvas for small edits.
- Web Workers for heavy import, export, layout, and validation tasks.
- Progress indicators for long operations.
- Cancel buttons for long operations.

Browser limits to consider:

- Maximum canvas dimensions.
- Memory limits on low-end devices.
- IndexedDB quota.
- File size limits.
- PDF generation time.
- SVG complexity.

## Accessibility

Accessibility requirements:

- Keyboard navigable menus and panels.
- Keyboard shortcuts for common actions.
- Visible focus states.
- Sufficient color contrast.
- Non-color indicators for validation status.
- Screen-reader labels for buttons and controls.
- Reduced motion option.
- Text should be resizable.
- UI should work at browser zoom levels from 80 percent to 200 percent.

Useful keyboard shortcuts:

- Ctrl/Cmd + N: new project.
- Ctrl/Cmd + O: open or import.
- Ctrl/Cmd + S: save.
- Ctrl/Cmd + Shift + S: save as.
- Ctrl/Cmd + E: export.
- Ctrl/Cmd + Z: undo.
- Ctrl/Cmd + Shift + Z: redo.
- Ctrl/Cmd + F: search.
- Delete or Backspace: delete selection.
- Space + drag: pan.
- Ctrl/Cmd + plus: zoom in.
- Ctrl/Cmd + minus: zoom out.
- Ctrl/Cmd + 0: fit to screen.

## Security and Privacy

Security requirements:

- No login.
- No project upload.
- No hidden remote sync.
- Imported SVG must be sanitized.
- Imported HTML must not be executed.
- External URLs in imported files should be blocked or require confirmation.
- File parsing should avoid unsafe dynamic code execution.
- User data should remain local.
- Error logs should not include project contents unless user explicitly exports diagnostics.

Privacy expectations:

- The app can function entirely offline.
- No analytics by default.
- No third-party tracking.
- No cloud fonts required for core functionality.
- Documentation should clearly explain where local data is stored.

## Browser Support

Recommended supported browsers:

- Latest Chrome.
- Latest Edge.
- Latest Firefox.
- Latest Safari.

Feature fallbacks:

- If File System Access API is unavailable, use download and upload flows.
- If large canvas export fails, offer lower scale or smaller scope.
- If IndexedDB is unavailable, warn that autosave is disabled.
- If clipboard image import is unavailable, use file picker.
- If web workers are unavailable, run tasks on main thread with warning for large files.

## Responsive Layout

Primary target is desktop and laptop browsers. Tablet support should be usable but not the main design constraint.

Desktop layout:

- Top bar fixed.
- Left object library.
- Center canvas.
- Right inspector.
- Bottom data panel.
- Panels resizable and collapsible.

Tablet layout:

- Canvas remains primary.
- Sidebars become drawers.
- Bottom panel becomes full-screen sheet.
- Touch-friendly hit targets.
- Pinch zoom and two-finger pan.

Small mobile layout:

- View and inspect projects.
- Basic edits only if practical.
- Strong warning that full design work is best on a larger screen.

## Edge Cases Checklist

Project and storage:

- User closes tab with unsaved changes.
- User refreshes during import or export.
- Browser crashes during edit.
- Browser storage quota reached.
- User opens same project in two tabs.
- User clears browser data.
- User works in private browsing mode.
- Unsupported browser feature.
- Very old `.nexmap` schema.
- Newer `.nexmap` schema than app supports.

Canvas:

- Empty canvas.
- Thousands of objects.
- Object dragged far outside visible area.
- Negative coordinates.
- Objects overlap exactly.
- Object too small to select.
- Very long device name.
- Labels overlap.
- Link endpoint deleted.
- Group contains locked objects.
- Hidden selected objects.
- Locked layer receives imported content.

Network data:

- Duplicate IP address.
- IPv4 and IPv6 in same project.
- Invalid subnet.
- Overlapping subnet.
- VLAN ID outside valid range.
- Duplicate VLAN name.
- Link without interfaces.
- Interface connected to wrong media type.
- Device with no interfaces.
- Rack unit collision.
- Firewall zone without rules.
- Cloud object missing region.

Import:

- Malformed file.
- Unsupported file.
- Wrong extension.
- Huge file.
- Empty file.
- Partial import failure.
- Duplicate object IDs.
- Duplicate names.
- Missing references.
- Unsafe SVG.
- CSV encoding issues.
- CSV delimiter mismatch.
- User cancels.

Export:

- Canvas too large.
- Browser canvas limit hit.
- PDF too many pages.
- Image export memory failure.
- Missing font.
- Transparent background with JPG.
- Hidden layers accidentally excluded.
- Exported selection has no objects.
- Filename invalid.
- User cancels save.

User experience:

- Accidental delete.
- Accidental project replace.
- Ambiguous save state.
- Slow operation with no progress.
- Keyboard shortcut conflict.
- Touch gesture conflict.
- Low contrast theme.
- Text too small.

## Suggested Implementation Stack

This is only a recommendation. The app can be built with another stack if preferred.

Recommended frontend:

- React or similar component framework.
- TypeScript.
- Vite for local development.
- Canvas or SVG-based diagram engine depending on performance needs.
- IndexedDB wrapper for local storage.
- Web Workers for import/export/validation.

Recommended rendering approach:

- Use SVG or a scene graph for crisp vector diagrams.
- Use canvas acceleration for very large diagrams if needed.
- Keep an internal model separate from visual rendering.
- Export from the internal model rather than screenshot-only rendering where possible.

Recommended libraries to evaluate:

- Diagramming or graph layout library for nodes and links.
- PDF generation library.
- SVG sanitization library.
- CSV parser.
- ZIP library for packaged exports.

## Minimum Viable Product

MVP should include:

- Local app with no login.
- New, open, save, and autosave.
- Native `.nexmap` import and export.
- Device library with common network objects.
- Canvas with drag, drop, pan, zoom, select, connect, and delete.
- Device and link properties inspector.
- Basic layers.
- Basic inventory table.
- PNG, JPG, SVG, and PDF export.
- CSV import for devices and links.
- CSV export for inventory and links.
- Validation for duplicate IPs, invalid CIDR, missing link endpoints, and duplicate names.
- Undo and redo.
- Import preview and error report.

## Post-MVP Enhancements

- Rack elevation mode.
- Cloud-specific objects and validations.
- Advanced auto-layout.
- Multi-view projects.
- GraphML import.
- Draw.io import.
- VSDX import.
- NetBox import/export.
- Terraform import.
- Nmap import.
- LLDP/CDP import.
- Wireless coverage planning.
- Change comparison between project files.
- Presentation mode.
- Export package zip.

## Definition of Done

The app should be considered ready when:

- A user can build a complete network topology locally without logging in.
- A user can close and reopen the browser without losing autosaved work.
- A user can save and reopen a `.nexmap` project file.
- A user can import device/link data from CSV with mapping and validation.
- A user can export clean PNG, JPG, SVG, and PDF files.
- Large diagrams remain responsive enough for real use.
- Import errors do not corrupt existing projects.
- Export failures provide useful recovery options.
- The app clearly communicates that data is local and user-owned.
