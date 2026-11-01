/**
 * Port VLANs — the layer-2 half of "is this device on VLAN 20?". The management IP
 * says which subnet (and so which VLAN) a device addresses itself into; the port
 * it's patched into says which VLAN the switch actually puts it on. A camera at
 * 10.20.0.10 on a VLAN 10 access port is misconfigured even though its address
 * looks right.
 *
 * Evidence is read where the design records it, per non-trunk link touching the
 * device: the far end's interface VLAN (the switch access port), the device's own
 * interface VLAN, and a single VLAN id typed on the link. Physical patch cables
 * (rack view) count the same way, port to port. Trunks carry many VLANs and say
 * nothing about one device, so they're skipped; untagged ports are unknown, not
 * wrong. A port seen through both a link and a cable counts once. Pure — no store,
 * no canvas.
 */
import type { Device, Link, RackCable } from './types';

export interface PortVlan {
  /** The VLAN id this evidence puts the device on. */
  vlan: number;
  /** Where the tag lives: a device's interface, or the link's own VLAN field. */
  on: { deviceId: string; ifaceId: string } | { linkId: string };
  /** Where, in words: "SW1 Gi0/3", "its port eth0", "its link to SW1". */
  where: string;
}

const nameOf = (d: Device) => d.name.trim() || d.type;

/** A link's VLAN field when it names exactly one valid id ("20"), else null. */
function singleVlan(text: string | undefined): number | null {
  const m = (text ?? '').trim().match(/^(\d{1,4})$/);
  const id = m ? Number(m[1]) : NaN;
  return id >= 1 && id <= 4094 ? id : null;
}

/** Every recorded port VLAN for `deviceId`, link by link (trunks skipped). */
export function portVlans(
  deviceId: string,
  devices: readonly Device[],
  links: readonly Link[],
  cables: readonly RackCable[] = [],
): PortVlan[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const self = byId.get(deviceId);
  if (!self) return [];
  const out: PortVlan[] = [];
  const seenPort = new Set<string>();
  const pushPort = (p: PortVlan & { on: { deviceId: string; ifaceId: string } }) => {
    const key = `${p.on.deviceId}:${p.on.ifaceId}`;
    if (seenPort.has(key)) return;
    seenPort.add(key);
    out.push(p);
  };
  for (const l of links) {
    if (l.mode === 'trunk' || l.sourceId === l.targetId) continue;
    const mine = l.sourceId === deviceId ? 'source' : l.targetId === deviceId ? 'target' : null;
    if (!mine) continue;
    const peer = byId.get(mine === 'source' ? l.targetId : l.sourceId);
    if (!peer) continue;
    const peerIfaceId = mine === 'source' ? l.targetIfaceId : l.sourceIfaceId;
    const ownIfaceId = mine === 'source' ? l.sourceIfaceId : l.targetIfaceId;
    const peerIface = peer.interfaces?.find((i) => i.id === peerIfaceId);
    if (peerIface?.vlan) {
      pushPort({
        vlan: peerIface.vlan,
        on: { deviceId: peer.id, ifaceId: peerIface.id },
        where: `${nameOf(peer)} ${peerIface.name.trim() || 'port'}`,
      });
    }
    const ownIface = self.interfaces?.find((i) => i.id === ownIfaceId);
    if (ownIface?.vlan) {
      pushPort({
        vlan: ownIface.vlan,
        on: { deviceId: self.id, ifaceId: ownIface.id },
        where: `its port ${ownIface.name.trim() || 'port'}`,
      });
    }
    const tagged = singleVlan(l.vlan);
    if (tagged !== null) out.push({ vlan: tagged, on: { linkId: l.id }, where: `its link to ${nameOf(peer)}` });
  }
  // Patch cables: port to port, no trunk flag and no VLAN of their own.
  for (const c of cables) {
    const [mine, theirs] =
      c.aEnd.deviceId === deviceId ? [c.aEnd, c.bEnd] : c.bEnd.deviceId === deviceId ? [c.bEnd, c.aEnd] : [null, null];
    if (!mine || !theirs || theirs.deviceId === deviceId) continue;
    const peer = byId.get(theirs.deviceId);
    const peerIface = peer?.interfaces?.find((i) => i.id === theirs.ifaceId);
    if (peer && peerIface?.vlan) {
      pushPort({
        vlan: peerIface.vlan,
        on: { deviceId: peer.id, ifaceId: peerIface.id },
        where: `${nameOf(peer)} ${peerIface.name.trim() || 'port'}`,
      });
    }
    const ownIface = self.interfaces?.find((i) => i.id === mine.ifaceId);
    if (ownIface?.vlan) {
      pushPort({
        vlan: ownIface.vlan,
        on: { deviceId: self.id, ifaceId: ownIface.id },
        where: `its port ${ownIface.name.trim() || 'port'}`,
      });
    }
  }
  return out;
}

/** The port VLANs that put `deviceId` somewhere other than `vlan`. */
export function wrongPortVlans(
  deviceId: string,
  vlan: number,
  devices: readonly Device[],
  links: readonly Link[],
  cables: readonly RackCable[] = [],
): PortVlan[] {
  return portVlans(deviceId, devices, links, cables).filter((p) => p.vlan !== vlan);
}

/** One port VLAN in words: "SW1 Gi0/3 is on VLAN 10" / "its link to SW1 is tagged VLAN 10". */
export function describePortVlan(p: PortVlan): string {
  return 'linkId' in p.on ? `${p.where} is tagged VLAN ${p.vlan}` : `${p.where} is on VLAN ${p.vlan}`;
}
