import { describe, it, expect } from 'vitest';
import { parseGraphml, parseDrawio, parseTopologyJson } from './graphImport';

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
