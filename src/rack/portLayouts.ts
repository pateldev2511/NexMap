/**
 * Per-kind port geometry — pure, and deliberately a LEAF module.
 *
 * Extracted from `rackDeviceArt.ts` to break an import cycle: the vendor skins need
 * this layout to draw outlets, while the generic art needs the skins (it falls back
 * to them). With the layout here, both art modules depend on this and on each other
 * in one direction only. ESM cycles compile fine and then hand you `undefined` at
 * module-init time, so the cycle is worth avoiding rather than tolerating.
 *
 * This is the single source of truth for WHERE a port is: the artwork draws from its
 * result and hit-testing consumes the same rects.
 */
import { portLayout, PATCH_PORT_OPTS, type Rect, type PortRect } from './rackLayout';
import { panelKindFor } from './panelKind';
import { slotOf } from './rackModel';
import {
  applianceFaceZones,
  patchPanelRows,
  serverFaceZones,
  switchFaceZones,
  upsFaceZones,
} from './faceZones';
import type { Device } from '@/model/types';

export function devicePortLayout(device: Device, panel: Rect): PortRect[] {
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
  const kind = panelKindFor(device.type);
  if (ports.length === 0) return [];
  if (kind === 'server') {
    // Laid out INSIDE the reserved port band, so vents/fans/drives — which derive
    // from the same zones — cannot collide with a jack. See faceZones.ts.
    const z = serverFaceZones(panel);
    return portLayout(z.ports, ports, { gap: 3, nameZone: 0, rightInset: 0, maxJack: 12 });
  }
  if (kind === 'ups') {
    // Outlets are REAL cablable ports (user decision 2026-08-09): documenting which
    // feed a device is corded into is ordinary infrastructure work. Laid out with the
    // same `portLayout` as data jacks so there is one geometry implementation, and
    // drawn from this same result so a click always lands where the outlet is.
    if (slotOf(device).mount === 'rail') {
      // A 0U vertical PDU: one column down the strip.
      return portLayout(panel, ports, {
        rows: ports.length,
        nameZone: 2,
        rightInset: 2,
        gap: 2,
        maxJack: 11,
      });
    }
    const z = upsFaceZones(panel);
    return portLayout(z.outlets, ports, { rows: 1, nameZone: 0, rightInset: 0, maxJack: 14 });
  }
  // A PSU shelf, cable manager and blanking panel genuinely have nothing to cable.
  if (kind === 'psu' || kind === 'cable-mgr' || kind === 'blank') return [];
  if (kind === 'patch') {
    // Rows derive from PHYSICAL DENSITY (24 keystones per 19" row), so a 24-port
    // panel is 1×24 and a 48-port panel is 2×24 — one row of 48 would need ~744mm
    // of a ~450mm panel and does not exist as hardware. Shared opts with the photo
    // skin so drawn ports and hit markers always align.
    return portLayout(panel, ports, {
      ...PATCH_PORT_OPTS,
      rows: patchPanelRows(ports.length),
    });
  }
  if (kind === 'switch' || kind === 'firewall') {
    // Switches DO stack 24/48 ports in two staggered rows (odd top / even
    // bottom via the column-major fill), separated into banks of 6. Laid out in
    // the reserved band so vents and SFP cages can't sit on a jack.
    const z = switchFaceZones(panel);
    return portLayout(z.ports, ports, { groupEvery: 6, groupGap: 6, nameZone: 0, rightInset: 0 });
  }
  if (kind === 'appliance') {
    // Router / LB / WLC: a sparse row of interface ports. Console/mgmt live in the
    // aux zone and are drawn by the art, not modelled as interfaces.
    const z = applianceFaceZones(panel);
    return portLayout(z.ports, ports, { rows: 1, nameZone: 0, rightInset: 0, maxJack: 13 });
  }
  return portLayout(panel, ports);
}
