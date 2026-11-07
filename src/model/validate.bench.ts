/**
 * IP-plan validation benchmark (issue #43). Run with `npx vitest bench --run
 * src/model/validate.bench.ts`; vitest prints mean, p75, p99 and p995 per case.
 * Not part of `vitest run` (which only collects *.test.ts), so no timing ever
 * gates CI — compare the same inputs before and after a change by hand.
 *
 * Three shapes at 100 / 500 / 1,000 subnets, every subnet with a gateway:
 *  - disjoint:  distinct /24s, no overlaps (the common real plan)
 *  - nested:    every 10th subnet a /16 holding the next nine /24s
 *  - duplicate: each /24 entered twice
 * "cold" alternates two plans of the same shape so nothing can be reused between
 * runs; "warm" re-validates one plan, as after an edit that touched no subnet.
 *
 * Interaction budget: validating a 1,000-subnet plan with 1,000 addressed devices,
 * cold, stays inside one 16 ms frame on a laptop-class CPU.
 *
 * Recorded 2026-11-07 on an Apple M2 Pro, Node 22.22, vitest 2.1 (jsdom), mean / p99 ms:
 *
 *                               before (pairwise)   after (sweep + reuse)
 *   disjoint  1,000 cold          494 / 523            1.5 / 1.8
 *   disjoint  1,000 warm          510 / 693            0.14 / 0.36
 *   disjoint  1,000 + devices    1017 / 2751           4.1 / 15  (busy machine)
 *   nested    1,000 cold          727 / 1533           1.7 / 2.2
 *   duplicate 1,000 cold          494 / 512            1.7 / 3.2
 *   disjoint    500 cold          136 / 249            0.76 / 0.99
 */
import { bench, describe } from 'vitest';
import { validate } from './validate';
import { createDevice, createSubnet } from './schema';
import type { Device, Subnet } from './types';

type Shape = 'disjoint' | 'nested' | 'duplicate';

/** `seed` shifts the second octet so two plans of one shape share no CIDR text. */
function plan(shape: Shape, n: number, seed: number): Subnet[] {
  const out: Subnet[] = [];
  const net = (i: number) => `10.${(seed * 64 + (i >> 8)) & 255}.${i & 255}`;
  for (let i = 0; out.length < n; i++) {
    if (shape === 'disjoint') {
      out.push(createSubnet(`${net(i)}.0/24`, { gateway: `${net(i)}.1` }));
    } else if (shape === 'duplicate') {
      out.push(createSubnet(`${net(i)}.0/24`, { gateway: `${net(i)}.1` }));
      if (out.length < n) out.push(createSubnet(`${net(i)}.0/24`, { gateway: `${net(i)}.1` }));
    } else {
      // One /16 per group, then nine /24s inside it.
      const second = (seed * 128 + i) & 255;
      out.push(createSubnet(`172.${second}.0.0/16`, { gateway: `172.${second}.0.1` }));
      for (let k = 1; k <= 9 && out.length < n; k++) {
        out.push(createSubnet(`172.${second}.${k}.0/24`, { gateway: `172.${second}.${k}.1` }));
      }
    }
  }
  return out;
}

/** One addressed device per subnet, inside it — exercises the ip-outside-subnet pass. */
function devicesFor(subnets: Subnet[]): Device[] {
  return subnets.map((s, i) =>
    createDevice('server', 0, 0, 'layer-1', {
      name: `srv-${i}`,
      managementIp: s.cidr.replace(/\.0\/\d+$/, `.${10 + (i % 200)}`),
    }),
  );
}

for (const shape of ['disjoint', 'nested', 'duplicate'] as const) {
  describe(`validate — ${shape} subnets`, () => {
    for (const n of [100, 500, 1000]) {
      const a = plan(shape, n, 0);
      const b = plan(shape, n, 1);
      let flip = false;
      bench(`${n} subnets, cold`, () => {
        flip = !flip;
        validate({ devices: [], links: [], subnets: flip ? a : b });
      });
      bench(`${n} subnets, warm`, () => {
        validate({ devices: [], links: [], subnets: a });
      });
    }
    const a = plan(shape, 1000, 0);
    const b = plan(shape, 1000, 1);
    const da = devicesFor(a);
    const db = devicesFor(b);
    let flip = false;
    bench('1000 subnets + 1000 devices, cold', () => {
      flip = !flip;
      validate(flip ? { devices: da, links: [], subnets: a } : { devices: db, links: [], subnets: b });
    });
  });
}
