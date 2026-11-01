import { describe, expect, it } from 'vitest';
import { parseRuleIntent, resolveRole } from './ruleIntent';

const ROLES = ['camera', 'access', 'core', 'guest', 'internal', 'Core Network'];

describe('parseRuleIntent — connectivity', () => {
  it.each([
    'every access connects to 2 core',
    'Every access connects to at least 2 core',
    'each access connects to ≥2 core',
    'all access links to >= 2 core.',
    'every access uplinks to 2 cores',
  ])('%s', (text) => {
    expect(parseRuleIntent(text, ROLES)).toEqual({ kind: 'connectivity', fromRole: 'access', target: 'core', min: 2 });
  });

  it('rejects a zero minimum rather than declaring a vacuous rule', () => {
    expect(parseRuleIntent('every access connects to 0 core', ROLES)).toBeNull();
  });
});

describe('parseRuleIntent — isolation', () => {
  it.each([
    'no guest may reach internal',
    'No guests can reach internal',
    'guest must not reach internal',
    'guests cannot reach internal',
    "guest can't reach internal",
    'isolate guest from internal',
  ])('%s', (text) => {
    expect(parseRuleIntent(text, ROLES)).toEqual({ kind: 'isolation', fromRole: 'guest', target: 'internal', min: 0 });
  });

  it('takes "quoted" multi-word roles and keeps the design’s spelling', () => {
    expect(parseRuleIntent('no guest may reach "core network"', ROLES)).toEqual({
      kind: 'isolation',
      fromRole: 'guest',
      target: 'Core Network',
      min: 0,
    });
  });
});

describe('parseRuleIntent — placement', () => {
  it.each([
    ['every camera lives in CCTV', 'CCTV'],
    'all cameras live in subnet CCTV',
    ['each camera is in the CCTV subnet', 'CCTV'],
    ['every camera in 10.20.0.0/24', '10.20.0.0/24'],
    ['every camera belongs in "Camera VLAN"', 'Camera VLAN'],
  ].map((x) => (Array.isArray(x) ? x : [x, 'CCTV'])))('%s', (text, subnet) => {
    expect(parseRuleIntent(text!, ROLES)).toEqual({ kind: 'placement', fromRole: 'camera', target: subnet, min: 0 });
  });
});

describe('parseRuleIntent — VLAN placement', () => {
  it.each([
    'every camera is on VLAN 20',
    'all cameras are on vlan20',
    'cameras on vlan 20',
    'each camera lives in VLAN-20',
    'every camera in the vlan 20',
  ])('%s', (text) => {
    expect(parseRuleIntent(text, ROLES)).toEqual({ kind: 'placement', fromRole: 'camera', target: 'VLAN 20', min: 0 });
  });

  it('an invalid VLAN id is not a rule', () => {
    expect(parseRuleIntent('every camera on vlan 5000', ROLES)).toBeNull();
    expect(parseRuleIntent('every camera on vlan 0', ROLES)).toBeNull();
  });
});

describe('parseRuleIntent — subnet spelling', () => {
  it('takes a known subnet’s spelling, else keeps what was typed', () => {
    expect(parseRuleIntent('every camera lives in cctv', ROLES, ['CCTV', '10.10.0.0/24'])!.target).toBe('CCTV');
    expect(parseRuleIntent('every camera lives in later', ROLES, ['CCTV'])!.target).toBe('later');
  });
});

describe('parseRuleIntent — non-rules', () => {
  it.each(['', 'restore', 'add router', 'every', 'no single point of failure', 'harden the design', 'every camera'])(
    '%j → null',
    (text) => {
      expect(parseRuleIntent(text, ROLES)).toBeNull();
    },
  );
});

describe('resolveRole', () => {
  it('matches case-insensitively, de-pluralizes to a known role, else keeps the typed word', () => {
    expect(resolveRole('CAMERA', ROLES)).toBe('camera');
    expect(resolveRole('cameras', ROLES)).toBe('camera');
    expect(resolveRole('accesses', ROLES)).toBe('access');
    expect(resolveRole('printers', ROLES)).toBe('printers'); // unknown → as typed
  });
});

describe('parseRuleIntent — count', () => {
  it.each([
    ['at least 2 core', 'core', 2],
    ['need at least 3 cores', 'core', 3],
    ['There must be ≥2 firewalls.', 'firewall', 2], // a device type, no device needed
    ['we need at least 2 access-points', 'access-point', 2],
    ['at least 2 firewall devices', 'firewall', 2],
    ['>= 2 "Core Network"', 'Core Network', 2],
    ['at least 4 widgets', 'widgets', 4], // unknown: kept as typed, never guessed
  ])('%j → at least %i of %j', (text, role, min) => {
    expect(parseRuleIntent(text, ROLES)).toEqual({ kind: 'count', fromRole: role, target: '', min });
  });

  it.each(['at least 0 core', 'at least 2 core switches', 'at least core'])('%j → null', (text) => {
    expect(parseRuleIntent(text, ROLES)).toBeNull();
  });
});
