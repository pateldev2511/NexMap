/**
 * Starter templates (design review DA-DES-1.3). These double as the first-run
 * empty-state cure and a feature demo — every template is a normal document built
 * from the same factories, so the user can edit it freely.
 *
 * One registry holds BOTH the metadata (name/description/category) and the geometry
 * (placed devices + edges), so the start-screen list and `buildTemplate` can never
 * drift apart. Grouped into Home & small office vs Enterprise & data center.
 */
import { createDevice, createEmptyDocument, createLink } from './schema';
import type { DeviceType, NexMapDocument } from './types';

export type TemplateCategory = 'general' | 'home' | 'enterprise';

export interface TemplateDef {
  key: string;
  name: string;
  description: string;
  category: TemplateCategory;
}

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  general: 'Start fresh',
  home: 'Home & small office',
  enterprise: 'Enterprise & data center',
};

interface Placed {
  type: DeviceType;
  name: string;
  x: number;
  y: number;
  ip?: string;
}

interface FullTemplate extends TemplateDef {
  placed: Placed[];
  edges: [number, number][];
}

/** Every template, metadata + geometry in one place. */
const DEFS: FullTemplate[] = [
  {
    key: 'blank',
    name: 'Blank project',
    description: 'Start from an empty canvas.',
    category: 'general',
    placed: [],
    edges: [],
  },

  // ----------------------------------------------------------------- HOME / SMB
  {
    key: 'home-wifi',
    name: 'Home Wi-Fi',
    description: 'Internet → Wi-Fi router + AP serving laptop, phone, TV, printer.',
    category: 'home',
    placed: [
      { type: 'isp', name: 'Internet', x: 320, y: 70 },
      { type: 'router', name: 'Wi-Fi Router', x: 320, y: 180, ip: '192.168.0.1' },
      { type: 'access-point', name: 'Access Point', x: 470, y: 180 },
      { type: 'end-user', name: 'Laptop', x: 170, y: 320, ip: '192.168.0.20' },
      { type: 'end-user', name: 'Phone', x: 300, y: 320, ip: '192.168.0.21' },
      { type: 'end-user', name: 'Smart TV', x: 430, y: 320, ip: '192.168.0.22' },
      { type: 'printer', name: 'Printer', x: 560, y: 320, ip: '192.168.0.23' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 4],
      [2, 5],
      [1, 6],
    ],
  },
  {
    key: 'mesh-wifi',
    name: 'Mesh Wi-Fi',
    description: 'Gateway with three mesh nodes blanketing the house.',
    category: 'home',
    placed: [
      { type: 'isp', name: 'Internet', x: 320, y: 70 },
      { type: 'router', name: 'Gateway', x: 320, y: 170, ip: '192.168.1.1' },
      { type: 'access-point', name: 'Mesh 1', x: 180, y: 300 },
      { type: 'access-point', name: 'Mesh 2', x: 320, y: 300 },
      { type: 'access-point', name: 'Mesh 3', x: 460, y: 300 },
      { type: 'end-user', name: 'Phone', x: 180, y: 420 },
      { type: 'end-user', name: 'Laptop', x: 320, y: 420 },
      { type: 'end-user', name: 'Tablet', x: 460, y: 420 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [3, 6],
      [4, 7],
    ],
  },
  {
    key: 'smart-home',
    name: 'Smart home / IoT',
    description: 'Router + switch tying together cameras, sensors, and a hub.',
    category: 'home',
    placed: [
      { type: 'router', name: 'Router', x: 320, y: 80, ip: '192.168.1.1' },
      { type: 'switch', name: 'Switch', x: 320, y: 200, ip: '192.168.1.2' },
      { type: 'camera', name: 'Front Cam', x: 150, y: 330 },
      { type: 'iot', name: 'Thermostat', x: 270, y: 330 },
      { type: 'iot', name: 'Smart Plug', x: 380, y: 330 },
      { type: 'end-user', name: 'Smart Hub', x: 490, y: 330 },
      { type: 'camera', name: 'Doorbell', x: 320, y: 450 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6],
    ],
  },
  {
    key: 'home-office',
    name: 'Home office',
    description: 'Workstation, NAS, printer and a VoIP phone behind a router.',
    category: 'home',
    placed: [
      { type: 'isp', name: 'Internet', x: 320, y: 70 },
      { type: 'router', name: 'Router', x: 320, y: 180, ip: '10.0.1.1' },
      { type: 'switch', name: 'Switch', x: 320, y: 300, ip: '10.0.1.2' },
      { type: 'end-user', name: 'Workstation', x: 150, y: 430, ip: '10.0.1.20' },
      { type: 'server', name: 'NAS', x: 290, y: 430, ip: '10.0.1.10' },
      { type: 'printer', name: 'Printer', x: 430, y: 430, ip: '10.0.1.21' },
      { type: 'end-user', name: 'VoIP Phone', x: 560, y: 430, ip: '10.0.1.22' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
    ],
  },
  {
    key: 'gaming-streaming',
    name: 'Gaming & streaming',
    description: 'Wired PC, console and TV plus a media NAS for low-latency play.',
    category: 'home',
    placed: [
      { type: 'router', name: 'Gaming Router', x: 320, y: 90, ip: '192.168.1.1' },
      { type: 'switch', name: 'Switch', x: 320, y: 220, ip: '192.168.1.2' },
      { type: 'end-user', name: 'Gaming PC', x: 150, y: 360, ip: '192.168.1.20' },
      { type: 'end-user', name: 'Console', x: 290, y: 360, ip: '192.168.1.21' },
      { type: 'end-user', name: 'Smart TV', x: 430, y: 360, ip: '192.168.1.22' },
      { type: 'server', name: 'Media NAS', x: 560, y: 360, ip: '192.168.1.10' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
    ],
  },
  {
    key: 'home-lab-pro',
    name: 'Advanced home lab',
    description: 'Firewall, managed switch, hypervisor with VMs/containers, NAS, UPS.',
    category: 'home',
    placed: [
      { type: 'isp', name: 'Internet', x: 340, y: 40 },
      { type: 'firewall', name: 'pfSense FW', x: 340, y: 140, ip: '10.10.0.1' },
      { type: 'switch', name: 'Managed SW', x: 340, y: 250, ip: '10.10.0.2' },
      { type: 'server', name: 'Hypervisor', x: 170, y: 370, ip: '10.10.0.10' },
      { type: 'vm', name: 'VM-1', x: 110, y: 500, ip: '10.10.0.30' },
      { type: 'vm', name: 'VM-2', x: 230, y: 500, ip: '10.10.0.31' },
      { type: 'container', name: 'Containers', x: 350, y: 500, ip: '10.10.0.40' },
      { type: 'storage', name: 'NAS', x: 480, y: 370, ip: '10.10.0.11' },
      { type: 'ups', name: 'UPS', x: 480, y: 500 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [3, 5],
      [2, 6],
      [2, 7],
      [2, 8],
    ],
  },
  {
    key: 'home-lab',
    name: 'Home lab',
    description: 'Router, switch, a NAS and a couple of VMs.',
    category: 'home',
    placed: [
      { type: 'router', name: 'Router', x: 320, y: 100, ip: '192.168.1.1' },
      { type: 'switch', name: 'Switch', x: 320, y: 240, ip: '192.168.1.2' },
      { type: 'server', name: 'NAS', x: 180, y: 380, ip: '192.168.1.10' },
      { type: 'vm', name: 'VM-1', x: 320, y: 380, ip: '192.168.1.20' },
      { type: 'vm', name: 'VM-2', x: 460, y: 380, ip: '192.168.1.21' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ],
  },
  {
    key: 'apartment',
    name: 'Apartment / dorm',
    description: 'The simplest setup: modem, Wi-Fi router, a laptop and a phone.',
    category: 'home',
    placed: [
      { type: 'isp', name: 'Modem', x: 300, y: 110 },
      { type: 'router', name: 'Wi-Fi Router', x: 300, y: 240, ip: '192.168.0.1' },
      { type: 'end-user', name: 'Laptop', x: 200, y: 380, ip: '192.168.0.20' },
      { type: 'end-user', name: 'Phone', x: 400, y: 380, ip: '192.168.0.21' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
    ],
  },

  // -------------------------------------------------------- ENTERPRISE / DC
  {
    key: 'small-office',
    name: 'Small office',
    description: 'ISP → firewall → switch → a few endpoints.',
    category: 'enterprise',
    placed: [
      { type: 'isp', name: 'ISP', x: 320, y: 80 },
      { type: 'firewall', name: 'FW-1', x: 320, y: 200, ip: '10.0.0.1' },
      { type: 'switch', name: 'SW-1', x: 320, y: 320, ip: '10.0.0.2' },
      { type: 'end-user', name: 'PC-1', x: 200, y: 440, ip: '10.0.0.10' },
      { type: 'end-user', name: 'PC-2', x: 320, y: 440, ip: '10.0.0.11' },
      { type: 'printer', name: 'Printer', x: 440, y: 440, ip: '10.0.0.12' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [2, 5],
    ],
  },
  {
    key: 'branch-office',
    name: 'Branch office',
    description: 'Edge firewall, core + two access switches, AP, printer, endpoints.',
    category: 'enterprise',
    placed: [
      { type: 'isp', name: 'ISP', x: 340, y: 40 },
      { type: 'firewall', name: 'Edge FW', x: 340, y: 140, ip: '10.20.0.1' },
      { type: 'switch', name: 'Core SW', x: 340, y: 250, ip: '10.20.0.2' },
      { type: 'switch', name: 'Access SW-1', x: 190, y: 370, ip: '10.20.0.3' },
      { type: 'switch', name: 'Access SW-2', x: 490, y: 370, ip: '10.20.0.4' },
      { type: 'end-user', name: 'PC-1', x: 110, y: 500 },
      { type: 'end-user', name: 'PC-2', x: 250, y: 500 },
      { type: 'access-point', name: 'AP', x: 400, y: 500 },
      { type: 'printer', name: 'Printer', x: 520, y: 500 },
      { type: 'end-user', name: 'PC-3', x: 600, y: 500 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [3, 5],
      [3, 6],
      [4, 7],
      [4, 8],
      [4, 9],
    ],
  },
  {
    key: 'campus-3tier',
    name: 'Three-tier campus',
    description: 'Core → distribution → access switches → per-floor endpoints.',
    category: 'enterprise',
    placed: [
      { type: 'switch', name: 'Core', x: 340, y: 80, ip: '10.0.0.1' },
      { type: 'switch', name: 'Dist-1', x: 200, y: 210, ip: '10.0.1.1' },
      { type: 'switch', name: 'Dist-2', x: 480, y: 210, ip: '10.0.2.1' },
      { type: 'switch', name: 'Access-1', x: 110, y: 350 },
      { type: 'switch', name: 'Access-2', x: 280, y: 350 },
      { type: 'switch', name: 'Access-3', x: 400, y: 350 },
      { type: 'switch', name: 'Access-4', x: 570, y: 350 },
      { type: 'end-user', name: 'Floor 1', x: 110, y: 480 },
      { type: 'end-user', name: 'Floor 2', x: 280, y: 480 },
      { type: 'end-user', name: 'Floor 3', x: 400, y: 480 },
      { type: 'end-user', name: 'Floor 4', x: 570, y: 480 },
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [2, 6],
      [3, 7],
      [4, 8],
      [5, 9],
      [6, 10],
    ],
  },
  {
    key: 'dmz-perimeter',
    name: 'DMZ / perimeter',
    description: 'Edge firewall fronting a DMZ (web + proxy) and an internal LAN.',
    category: 'enterprise',
    placed: [
      { type: 'isp', name: 'Internet', x: 340, y: 40 },
      { type: 'firewall', name: 'Edge FW', x: 340, y: 140, ip: '203.0.113.1' },
      { type: 'switch', name: 'DMZ SW', x: 180, y: 260, ip: '172.16.0.1' },
      { type: 'server', name: 'Web Server', x: 110, y: 390, ip: '172.16.0.10' },
      { type: 'load-balancer', name: 'Reverse Proxy', x: 250, y: 390, ip: '172.16.0.11' },
      { type: 'firewall', name: 'Internal FW', x: 480, y: 260, ip: '10.0.0.1' },
      { type: 'switch', name: 'LAN SW', x: 480, y: 390, ip: '10.0.0.2' },
      { type: 'end-user', name: 'Workstation', x: 480, y: 510, ip: '10.0.0.20' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [1, 5],
      [5, 6],
      [6, 7],
    ],
  },
  {
    key: 'datacenter-rack',
    name: 'Data center rack',
    description: 'Redundant top-of-rack switches feeding servers, SAN and UPS.',
    category: 'enterprise',
    placed: [
      { type: 'switch', name: 'ToR SW-A', x: 240, y: 90, ip: '10.0.0.1' },
      { type: 'switch', name: 'ToR SW-B', x: 440, y: 90, ip: '10.0.0.2' },
      { type: 'server', name: 'Server 1', x: 150, y: 250, ip: '10.0.0.11' },
      { type: 'server', name: 'Server 2', x: 300, y: 250, ip: '10.0.0.12' },
      { type: 'server', name: 'Server 3', x: 450, y: 250, ip: '10.0.0.13' },
      { type: 'storage', name: 'SAN', x: 560, y: 250, ip: '10.0.0.20' },
      { type: 'ups', name: 'UPS', x: 340, y: 410 },
    ],
    edges: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 2],
      [1, 3],
      [1, 4],
      [0, 5],
      [1, 5],
    ],
  },
  {
    key: 'wan-hub-spoke',
    name: 'WAN hub & spoke',
    description: 'HQ router linked to three branch routers over the WAN.',
    category: 'enterprise',
    placed: [
      { type: 'router', name: 'HQ Router', x: 340, y: 90, ip: '10.0.0.1' },
      { type: 'isp', name: 'WAN / MPLS', x: 340, y: 210 },
      { type: 'router', name: 'Branch A', x: 160, y: 360, ip: '10.1.0.1' },
      { type: 'router', name: 'Branch B', x: 340, y: 360, ip: '10.2.0.1' },
      { type: 'router', name: 'Branch C', x: 520, y: 360, ip: '10.3.0.1' },
      { type: 'end-user', name: 'A LAN', x: 160, y: 480 },
      { type: 'end-user', name: 'B LAN', x: 340, y: 480 },
      { type: 'end-user', name: 'C LAN', x: 520, y: 480 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [3, 6],
      [4, 7],
    ],
  },
  {
    key: 'ha-core',
    name: 'Redundant core (HA)',
    description: 'Dual firewalls and dual core switches in a high-availability pair.',
    category: 'enterprise',
    placed: [
      { type: 'isp', name: 'Internet', x: 340, y: 40 },
      { type: 'firewall', name: 'FW-A', x: 220, y: 150, ip: '10.0.0.1' },
      { type: 'firewall', name: 'FW-B', x: 460, y: 150, ip: '10.0.0.2' },
      { type: 'switch', name: 'Core-A', x: 220, y: 290, ip: '10.0.0.3' },
      { type: 'switch', name: 'Core-B', x: 460, y: 290, ip: '10.0.0.4' },
      { type: 'switch', name: 'Access', x: 340, y: 420, ip: '10.0.0.5' },
      { type: 'end-user', name: 'Workstation', x: 340, y: 530 },
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 4],
      [3, 5],
      [4, 5],
      [5, 6],
    ],
  },
  {
    key: 'hybrid-cloud',
    name: 'Hybrid cloud',
    description: 'On-prem LAN to a cloud VPC over VPN, with managed DB and Kubernetes.',
    category: 'enterprise',
    placed: [
      { type: 'end-user', name: 'On-prem PC', x: 80, y: 130 },
      { type: 'switch', name: 'LAN SW', x: 200, y: 130, ip: '10.0.0.2' },
      { type: 'firewall', name: 'Edge FW', x: 200, y: 260, ip: '10.0.0.1' },
      { type: 'vpn-gateway', name: 'VPN GW', x: 200, y: 390 },
      { type: 'cloud', name: 'Cloud VPC', x: 460, y: 130 },
      { type: 'cloud-subnet', name: 'Private Subnet', x: 460, y: 260 },
      { type: 'managed-db', name: 'Managed DB', x: 380, y: 400 },
      { type: 'k8s', name: 'Kubernetes', x: 540, y: 400 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [5, 7],
    ],
  },
  {
    key: 'wireless-campus',
    name: 'Wireless campus',
    description: 'WLAN controller + PoE switch driving multiple access points.',
    category: 'enterprise',
    placed: [
      { type: 'wireless-controller', name: 'WLC', x: 340, y: 90, ip: '10.0.0.5' },
      { type: 'switch', name: 'PoE Switch', x: 340, y: 220, ip: '10.0.0.2' },
      { type: 'access-point', name: 'AP-1', x: 170, y: 350 },
      { type: 'access-point', name: 'AP-2', x: 340, y: 350 },
      { type: 'access-point', name: 'AP-3', x: 510, y: 350 },
      { type: 'end-user', name: 'Client 1', x: 170, y: 470 },
      { type: 'end-user', name: 'Client 2', x: 340, y: 470 },
      { type: 'end-user', name: 'Client 3', x: 510, y: 470 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [3, 6],
      [4, 7],
    ],
  },
];

/** Start-screen metadata, in registry order. */
export const TEMPLATES: TemplateDef[] = DEFS.map(
  ({ key, name, description, category }) => ({ key, name, description, category }),
);

/** Build a fresh document for a template key (unknown key → blank). */
export function buildTemplate(key: string, now: string): NexMapDocument {
  const def = DEFS.find((d) => d.key === key);
  if (!def || def.placed.length === 0) return createEmptyDocument(now);

  const doc = createEmptyDocument(now);
  doc.project = { ...doc.project, name: def.name };
  const layerId = doc.layers[0]!.id;
  const devices = def.placed.map((p) =>
    createDevice(p.type, p.x, p.y, layerId, { name: p.name, managementIp: p.ip }),
  );
  doc.devices = devices;
  doc.links = def.edges.map(([a, b]) =>
    createLink(devices[a]!.id, devices[b]!.id, layerId),
  );
  return doc;
}
