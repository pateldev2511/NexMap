import { describe, it, expect } from 'vitest';
import { TEMPLATES, buildTemplate, buildTemplateObjects } from './templates';
import { validate } from './validate';
import { blastRadius } from '@/sim/blastRadius';

const LAYER = 'layer';
const CENTER = { x: 400, y: 400 };
const insertable = TEMPLATES.filter((t) => t.key !== 'blank');

describe('buildTemplateObjects (Conductor insert)', () => {
  it('returns null for blank / unknown keys', () => {
    expect(buildTemplateObjects('blank', CENTER, LAYER)).toBeNull();
    expect(buildTemplateObjects('does-not-exist', CENTER, LAYER)).toBeNull();
  });

  it('mints one device per node and one link per edge, with no dangling endpoints', () => {
    for (const tpl of insertable) {
      const built = buildTemplateObjects(tpl.key, CENTER, LAYER)!;
      expect(built, tpl.key).not.toBeNull();
      const ids = new Set(built.devices.map((d) => d.id));
      expect(ids.size).toBe(built.devices.length); // unique ids
      for (const l of built.links) {
        expect(ids.has(l.sourceId), `${tpl.key} link source`).toBe(true);
        expect(ids.has(l.targetId), `${tpl.key} link target`).toBe(true);
      }
    }
  });

  it('drops management IPs so inserts never collide with the existing diagram', () => {
    // Pick a template that ships IPs in its starter form.
    const built = buildTemplateObjects('home-office', CENTER, LAYER)!;
    expect(built.devices.every((d) => d.managementIp == null)).toBe(true);
  });

  it('centers the inserted group on the requested point', () => {
    const built = buildTemplateObjects('branch-office', CENTER, LAYER)!;
    const cx = built.devices.reduce((s, d) => s + d.x + d.width / 2, 0) / built.devices.length;
    const cy = built.devices.reduce((s, d) => s + d.y + d.height / 2, 0) / built.devices.length;
    // Means land near the center; exact offset depends on the shape's balance.
    expect(Math.abs(cx - CENTER.x)).toBeLessThan(160);
    expect(Math.abs(cy - CENTER.y)).toBeLessThan(160);
  });

  it('every insertable template validates without errors', () => {
    for (const tpl of insertable) {
      const { devices, links } = buildTemplateObjects(tpl.key, CENTER, LAYER)!;
      const issues = validate({ devices, links, vlans: [], subnets: [], racks: [] });
      const errors = issues.filter((i) => i.severity === 'error' || i.severity === 'critical');
      expect(errors, `${tpl.key} should have no errors`).toEqual([]);
    }
  });
});

describe('buildTemplate (first-run document) is unchanged', () => {
  it('keeps starter IPs when building a fresh document', () => {
    const doc = buildTemplate('home-office', '2026-01-01T00:00:00.000Z');
    expect(doc.devices.some((d) => d.managementIp)).toBe(true);
  });
});

describe('the redundant templates actually survive a single failure', () => {
  it('Redundant core (HA) isolates nobody when one firewall dies', () => {
    const { devices, links } = buildTemplateObjects('ha-core', CENTER, LAYER)!;
    const fw = devices.find((d) => d.name === 'FW-A')!;
    const r = blastRadius(devices, links, [fw.id]);
    expect(r.isolated.size).toBe(0);
  });

  it('Data center rack keeps servers reachable when one ToR switch dies', () => {
    const { devices, links } = buildTemplateObjects('datacenter-rack', CENTER, LAYER)!;
    const tor = devices.find((d) => d.name === 'ToR SW-A')!;
    const r = blastRadius(devices, links, [tor.id]);
    expect(r.isolated.size).toBe(0);
  });

  it('App tier keeps the database reachable when one web node dies', () => {
    const { devices, links } = buildTemplateObjects('app-tier', CENTER, LAYER)!;
    const web1 = devices.find((d) => d.name === 'Web 1')!;
    const r = blastRadius(devices, links, [web1.id]);
    // The web↔app mesh means losing one web node isolates nobody.
    expect(r.isolated.size).toBe(0);
  });
});
