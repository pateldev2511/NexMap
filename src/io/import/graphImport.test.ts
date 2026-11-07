import { describe, it, expect } from 'vitest';
import {
  parseGraphml,
  parseDrawio,
  parseTopologyJson,
  parseNetboxJson,
  parseNmapXml,
  looksLikeNetbox,
  stripExternalSvgReferences,
} from './graphImport';
import { useProjectStore } from '@/store/projectStore';

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

  it('prefers label/name keys over unrelated data values', () => {
    const xml = `<?xml version="1.0"?>
      <graphml>
        <key id="d0" for="node" attr.name="ip"/>
        <key id="d1" for="node" attr.name="label"/>
        <graph>
          <node id="a"><data key="d0">10.0.0.1</data><data key="d1">Core Router</data></node>
        </graph>
      </graphml>`;
    const r = parseGraphml(xml, L);
    expect(r.devices[0]!.name).toBe('Core Router');
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

  describe('multi-page files with reused cell ids', () => {
    // draw.io numbers cells per page, so both pages use ids 2 and 3.
    const page = (name: string, cells: string) =>
      `<diagram name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`;
    const pair = (a: string, b: string, edges: string) =>
      `<mxCell id="2" value="${a}" vertex="1" parent="1"/><mxCell id="3" value="${b}" vertex="1" parent="1"/>${edges}`;
    const twoPages = (extraB = '') =>
      `<mxfile>${page('Site A', pair('A1', 'A2', '<mxCell id="4" edge="1" source="2" target="3"/>'))}${page(
        'Site B',
        pair('B1', 'B2', `<mxCell id="4" edge="1" source="2" target="3"/>${extraB}`),
      )}</mxfile>`;
    const named = (r: ReturnType<typeof parseDrawio>) => {
      const n = new Map(r.devices.map((d) => [d.id, d.name]));
      return r.links.map((l) => `${n.get(l.sourceId)}->${n.get(l.targetId)}`);
    };

    it('resolves every edge within its own page', () => {
      const r = parseDrawio(twoPages(), L);
      expect(r.devices.map((d) => d.name)).toEqual(['A1', 'A2', 'B1', 'B2']);
      expect(named(r)).toEqual(['A1->A2', 'B1->B2']);
      expect(r.skipped).toBe(0);
      expect(r.warnings).toEqual([
        'Merged 2 draw.io pages (Site A, Site B); links are matched within each page.',
      ]);
    });

    it('never resolves an edge against another page, and names the page', () => {
      // Page B's edge points at id 9, which only exists on page A.
      const xml = `<mxfile>${page(
        'Site A',
        pair('A1', 'A2', '<mxCell id="9" value="A3" vertex="1"/>'),
      )}${page('Site B', pair('B1', 'B2', '<mxCell id="5" edge="1" source="2" target="9"/>'))}</mxfile>`;
      const r = parseDrawio(xml, L);
      expect(r.links).toEqual([]);
      expect(r.skipped).toBe(1);
      expect(r.warnings).toContain(
        'Page "Site B": 1 edge(s) had unmapped endpoints and were skipped.',
      );
    });

    it('keeps resolved edges when a sibling edge on the page is dangling', () => {
      const r = parseDrawio(twoPages('<mxCell id="5" edge="1" source="2"/>'), L);
      expect(named(r)).toEqual(['A1->A2', 'B1->B2']);
      expect(r.skipped).toBe(1);
    });

    it('starts each page on its own layout row', () => {
      const r = parseDrawio(twoPages(), L);
      const [a1, , b1] = r.devices;
      expect(b1!.x).toBe(a1!.x);
      expect(b1!.y).toBeGreaterThan(a1!.y);
    });

    it('skips a compressed page by name and imports the readable one', () => {
      const xml = `<mxfile>${page('Site A', pair('A1', 'A2', '<mxCell id="4" edge="1" source="2" target="3"/>'))}<diagram name="Old">eJzLSM3JyQcABiwCFQ==</diagram></mxfile>`;
      const r = parseDrawio(xml, L);
      expect(named(r)).toEqual(['A1->A2']);
      expect(r.warnings.some((w) => /^Page "Old" has no readable cells/.test(w))).toBe(
        true,
      );
    });

    it('commits as one undo step', () => {
      const s = () => useProjectStore.getState();
      s().newProject('2026-01-01T00:00:00.000Z');
      const r = parseDrawio(twoPages(), s().defaultLayerId());
      s().importObjects(r.devices, r.links);
      expect(s().devicesAll()).toHaveLength(4);
      expect(s().linksAll()).toHaveLength(2);
      s().undo();
      expect(s().devicesAll()).toHaveLength(0);
      expect(s().linksAll()).toHaveLength(0);
    });
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

  it.each(['null', '[]', '"devices"', '7', '{"devices":null}', '{"devices":{}}'])(
    'rejects a non-object root or devices value (%s) without throwing',
    (json) => {
      const r = parseTopologyJson(json, L);
      expect(r.devices).toEqual([]);
      expect(r.warnings).toEqual([
        'JSON has no "devices" array. For full .nexmap files use Open instead.',
      ]);
    },
  );

  it('skips malformed device and link rows, naming each, and keeps the good ones', () => {
    const json = JSON.stringify({
      devices: [
        { name: 'R1', type: 'router' },
        null,
        'SW1',
        [],
        { name: 'SW1' },
        { name: 7 },
      ],
      links: [
        { source: 'R1', target: 'SW1' },
        null,
        42,
        { source: 'R1', target: 'ghost' },
        { source: { name: 'R1' }, target: 'SW1' },
        { source: 7, target: 'R1' },
      ],
    });
    const r = parseTopologyJson(json, L);
    expect(r.devices.map((d) => d.name)).toEqual(['R1', 'SW1', '7']);
    expect(r.links).toHaveLength(2);
    expect(r.skipped).toBe(7); // 3 device rows + 2 non-object links + 2 unknown endpoints
    expect(r.warnings).toEqual([
      'Device 2: not a device object — skipped.',
      'Device 3: not a device object — skipped.',
      'Device 4: not a device object — skipped.',
      'Link 2: not a link object — skipped.',
      'Link 3: not a link object — skipped.',
      '2 link(s) referenced unknown devices and were skipped.',
    ]);
    // Skipped rows leave no holes in the layout grid.
    expect(r.devices[1]!.x - r.devices[0]!.x).toBe(r.devices[2]!.x - r.devices[1]!.x);
  });

  it('warns when "links" is present but not an array', () => {
    const r = parseTopologyJson('{"devices":[{"name":"R1"}],"links":{"a":1}}', L);
    expect(r.devices).toHaveLength(1);
    expect(r.warnings).toEqual(['"links" is not an array — no links imported.']);
  });

  it('skips a link whose endpoint names two devices instead of picking the last', () => {
    const json = JSON.stringify({
      devices: [{ name: 'core' }, { name: 'core' }, { name: 'edge' }],
      links: [{ source: 'core', target: 'edge' }],
    });
    const r = parseTopologyJson(json, L);
    expect(r.links).toEqual([]);
    expect(r.warnings[0]).toMatch(/^Link 1: "core" matches 2 devices: .* — skipped\.$/);
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

  it('skips null and non-object results with a row warning instead of throwing', () => {
    const json = JSON.stringify({
      results: [
        null,
        { name: 'sw-1', site: 'HQ', device_type: null },
        'x',
        { name: 'fw-1' },
      ],
    });
    expect(looksLikeNetbox(json)).toBe(true);
    const r = parseNetboxJson(json, L);
    expect(r.devices.map((d) => d.name)).toEqual(['sw-1', 'fw-1']);
    expect(r.devices[0]!.location).toBeUndefined(); // site was a string, not { name }
    expect(r.skipped).toBe(2);
    expect(r.warnings).toEqual([
      'Device 1: not a device object — skipped.',
      'Device 3: not a device object — skipped.',
    ]);
  });

  it('rejects a root without a results array', () => {
    expect(looksLikeNetbox('null')).toBe(false);
    for (const json of ['null', '[]', '{"results":{}}']) {
      const r = parseNetboxJson(json, L);
      expect(r.devices).toEqual([]);
      expect(r.warnings[0]).toMatch(/no "results" array/);
    }
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

describe('stripExternalSvgReferences', () => {
  it('removes remote references and event handlers while keeping local refs', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="shadow"></filter></defs>
      <image href="https://example.com/track.png" onclick="alert(1)"/>
      <rect fill="url(#shadow)" filter="url(https://example.com/filter.svg#x)"/>
    </svg>`;
    const result = stripExternalSvgReferences(raw);
    expect(result.stripped).toBeGreaterThanOrEqual(3);
    expect(result.svg).not.toContain('https://example.com');
    expect(result.svg).not.toContain('onclick');
    expect(result.svg).toContain('url(#shadow)');
  });
});
