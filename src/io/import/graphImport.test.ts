import { describe, it, expect } from 'vitest';
import { parseGraphml, parseDrawio, parseTopologyJson, parseNetboxJson, parseNmapXml, looksLikeNetbox } from './graphImport';

const L = 'layer';

describe('parseGraphml', () => {
  it('imports nodes and edges', () => {
    const xml = `<?xml version="1.0"?>
      <graphml><graph>
        <node id="a"><data key="label">Core Router</data></node>
        <node id="b"><data key="label">Switch1</data></node>
        <edge source="a" target="b"/>
      </graph></graphml>`;
    const r = parseGraphml(xml, L);
    expect(r.devices).toHaveLength(2);
    expect(r.devices[0]!.name).toBe('Core Router');
    expect(r.devices[0]!.type).toBe('router'); // inferred from label
    expect(r.links).toHaveLength(1);
  });

  it('warns on unresolved edge endpoints', () => {
    const xml = `<graphml><graph><node id="a"/><edge source="a" target="ghost"/></graph></graphml>`;
    const r = parseGraphml(xml, L);
    expect(r.links).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('handles invalid XML', () => {
    const r = parseGraphml('<graphml><graph>', L);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseDrawio', () => {
  it('imports vertices and edges from mxGraph', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" value="Firewall" vertex="1"/>
      <mxCell id="2" value="Server" vertex="1"/>
      <mxCell id="3" edge="1" source="1" target="2" value="uplink"/>
    </root></mxGraphModel>`;
    const r = parseDrawio(xml, L);
    expect(r.devices).toHaveLength(2);
    expect(r.devices[0]!.type).toBe('firewall');
    expect(r.links).toHaveLength(1);
    expect(r.links[0]!.name).toBe('uplink');
  });

  it('warns on a compressed/empty file', () => {
    const r = parseDrawio('<mxfile><diagram>base64deflate==</diagram></mxfile>', L);
    expect(r.warnings.some((w) => /compressed/.test(w))).toBe(true);
  });
});

describe('parseTopologyJson', () => {
  it('imports devices+links by name', () => {
    const json = JSON.stringify({
      devices: [
        { name: 'R1', type: 'router', ip: '10.0.0.1' },
        { name: 'SW1', type: 'switch' },
      ],
      links: [{ source: 'R1', target: 'SW1' }],
    });
    const r = parseTopologyJson(json, L);
    expect(r.devices).toHaveLength(2);
    expect(r.devices[0]!.managementIp).toBe('10.0.0.1');
    expect(r.links).toHaveLength(1);
  });

  it('rejects JSON without a devices array', () => {
    expect(parseTopologyJson('{"foo":1}', L).warnings.length).toBeGreaterThan(0);
    expect(parseTopologyJson('not json', L).warnings[0]).toMatch(/valid JSON/);
  });
});

describe('NetBox import', () => {
  const nb = JSON.stringify({
    results: [
      {
        name: 'sw-core-1',
        device_role: { name: 'switch' },
        device_type: { model: 'C9300', manufacturer: { name: 'Cisco' } },
        site: { name: 'HQ' },
        primary_ip: { address: '10.0.0.2/24' },
      },
    ],
  });

  it('detects and parses a NetBox device export', () => {
    expect(looksLikeNetbox(nb)).toBe(true);
    expect(looksLikeNetbox('{"devices":[]}')).toBe(false);
    const r = parseNetboxJson(nb, L);
    expect(r.devices).toHaveLength(1);
    const d = r.devices[0]!;
    expect(d.name).toBe('sw-core-1');
    expect(d.type).toBe('switch'); // inferred from role
    expect(d.vendor).toBe('Cisco');
    expect(d.model).toBe('C9300');
    expect(d.location).toBe('HQ');
    expect(d.managementIp).toBe('10.0.0.2/24');
  });
});

describe('parseNmapXml', () => {
  it('imports up hosts with IP, hostname, and OS-inferred type', () => {
    const xml = `<?xml version="1.0"?><nmaprun>
      <host><status state="up"/><address addr="10.0.0.1" addrtype="ipv4"/>
        <hostnames><hostname name="gw.local"/></hostnames>
        <os><osmatch name="Cisco IOS router"/></os></host>
      <host><status state="down"/><address addr="10.0.0.2" addrtype="ipv4"/></host>
    </nmaprun>`;
    const r = parseNmapXml(xml, 'L');
    expect(r.devices).toHaveLength(1);
    expect(r.devices[0]!.name).toBe('gw.local');
    expect(r.devices[0]!.managementIp).toBe('10.0.0.1');
    expect(r.devices[0]!.type).toBe('router'); // inferred from OS string
    expect(r.skipped).toBe(1); // the down host
  });

  it('rejects non-nmap XML', () => {
    expect(parseNmapXml('<foo/>', 'L').warnings.length).toBeGreaterThan(0);
  });
});
