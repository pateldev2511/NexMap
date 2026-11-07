/**
 * A two-site design for the export tests: HQ and a branch, each a router + switch,
 * joined by a WAN link, with one subnet per site and a declared rule. Selecting
 * one site and exporting is the "share a single site" case.
 */
import { createDevice, createEmptyDocument, createLink, createSubnet } from '@/model/schema';
import type { NexMapDocument } from '@/model/types';

export function twoSiteDoc() {
  const doc: NexMapDocument = createEmptyDocument('2026-01-01T00:00:00.000Z');
  const L = doc.layers[0]!.id;
  const hqR = createDevice('router', 0, 0, L, { name: 'HQ-R1', managementIp: '10.1.0.1' });
  const hqSw = createDevice('switch', 240, 0, L, { name: 'HQ-SW1', managementIp: '10.1.0.2' });
  const brR = createDevice('router', 0, 400, L, { name: 'BR-R1', managementIp: '10.2.0.1' });
  const brSw = createDevice('switch', 240, 400, L, { name: 'BR-SW1', managementIp: '10.2.0.2' });
  const hqLink = createLink(hqR.id, hqSw.id, L);
  const brLink = createLink(brR.id, brSw.id, L);
  const wan = createLink(hqR.id, brR.id, L);
  doc.project.name = 'Two sites';
  doc.devices = [hqR, hqSw, brR, brSw];
  doc.links = [hqLink, brLink, wan];
  doc.subnets = [
    createSubnet('10.1.0.0/24', { name: 'HQ', gateway: '10.1.0.1' }),
    createSubnet('10.2.0.0/24', { name: 'Branch', gateway: '10.2.0.1' }),
  ];
  doc.invariants = ['every-device-named'];
  return { doc, hq: { devices: [hqR, hqSw], links: [hqLink] }, wan };
}
