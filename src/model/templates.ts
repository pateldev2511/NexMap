/**
 * Starter templates (design review DA-DES-1.3). These double as the first-run
 * empty-state cure and a feature demo. MVP ships a small set; the spec's full
 * template library (branch office, data center, etc.) is Post-MVP.
 *
 * Built from the same factories as everything else, so a template is just a
 * normal document the user can edit freely.
 */
import { createDevice, createEmptyDocument, createLink } from './schema';
import type { DeviceType, NexMapDocument } from './types';

export interface TemplateDef {
  key: string;
  name: string;
  description: string;
}

export const TEMPLATES: TemplateDef[] = [
  { key: 'blank', name: 'Blank project', description: 'Start from an empty canvas.' },
  {
    key: 'small-office',
    name: 'Small office',
    description: 'ISP → firewall → switch → a few endpoints.',
  },
  {
    key: 'home-lab',
    name: 'Home lab',
    description: 'Router, switch, a server and a couple of VMs.',
  },
];

interface Placed {
  type: DeviceType;
  name: string;
  x: number;
  y: number;
  ip?: string;
}

function build(
  now: string,
  name: string,
  placed: Placed[],
  edges: [number, number][],
): NexMapDocument {
  const doc = createEmptyDocument(now);
  doc.project = { ...doc.project, name };
  const layerId = doc.layers[0]!.id;
  const devices = placed.map((p) =>
    createDevice(p.type, p.x, p.y, layerId, { name: p.name, managementIp: p.ip }),
  );
  doc.devices = devices;
  doc.links = edges.map(([a, b]) => createLink(devices[a]!.id, devices[b]!.id, layerId));
  return doc;
}

export function buildTemplate(key: string, now: string): NexMapDocument {
  switch (key) {
    case 'small-office':
      return build(
        now,
        'Small Office',
        [
          { type: 'isp', name: 'ISP', x: 320, y: 80 },
          { type: 'firewall', name: 'FW-1', x: 320, y: 200, ip: '10.0.0.1' },
          { type: 'switch', name: 'SW-1', x: 320, y: 320, ip: '10.0.0.2' },
          { type: 'end-user', name: 'PC-1', x: 200, y: 440, ip: '10.0.0.10' },
          { type: 'end-user', name: 'PC-2', x: 320, y: 440, ip: '10.0.0.11' },
          { type: 'printer', name: 'Printer', x: 440, y: 440, ip: '10.0.0.12' },
        ],
        [
          [0, 1],
          [1, 2],
          [2, 3],
          [2, 4],
          [2, 5],
        ],
      );
    case 'home-lab':
      return build(
        now,
        'Home Lab',
        [
          { type: 'router', name: 'Router', x: 320, y: 100, ip: '192.168.1.1' },
          { type: 'switch', name: 'Switch', x: 320, y: 240, ip: '192.168.1.2' },
          { type: 'server', name: 'NAS', x: 180, y: 380, ip: '192.168.1.10' },
          { type: 'vm', name: 'VM-1', x: 320, y: 380, ip: '192.168.1.20' },
          { type: 'vm', name: 'VM-2', x: 460, y: 380, ip: '192.168.1.21' },
        ],
        [
          [0, 1],
          [1, 2],
          [1, 3],
          [1, 4],
        ],
      );
    case 'blank':
    default:
      return createEmptyDocument(now);
  }
}
