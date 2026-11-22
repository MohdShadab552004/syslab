import { describe, test, expect } from 'vitest';
import { KINDS, SIZES, TECHS } from '@syslab/sim';
import { DESIGN_GUIDE, SIZE_TABLE, componentCatalog } from '../src/catalog';
import { KIND_VALUES, SIZE_VALUES } from '../src/schema';

describe('componentCatalog', () => {
  const cat = componentCatalog();
  const byKind = Object.fromEntries(cat.map((c) => [c.kind, c]));

  test('has one entry per kind, matching the schema kinds', () => {
    expect(cat.map((c) => c.kind).sort()).toEqual([...KIND_VALUES].sort());
    for (const c of cat) {
      expect(c.name).toBe(KINDS[c.kind].name);
      expect(c.use).toBe(KINDS[c.kind].desc);
      expect(c.latencyMs).toBe(KINDS[c.kind].lat);
      expect(c.technologies.map((t) => t.tech)).toEqual(TECHS[c.kind]);
    }
  });

  test('capacity text depends on the kind', () => {
    expect(byKind.users.capacity).toBe('generates traffic (0.06 requests/s per concurrent user)');
    expect(byKind.app.capacity).toBe('150 requests/s per vCPU (16vCPU ≈ 2400/s), sized');
    expect(byKind.lb.capacity).toBe('120000 requests/s per instance, fixed size');
  });

  test('autoscale and async flags', () => {
    expect(byKind.app.canAutoscale).toBe(true);
    expect(byKind.worker.canAutoscale).toBe(true);
    expect(byKind.db.canAutoscale).toBe(false);
    expect(byKind.queue.async).toBe(true);
    expect(byKind.app.async).toBe(false);
  });

  test('technologies carry profile multipliers, and connection limits for SQL databases', () => {
    const go = byKind.app.technologies.find((t) => t.tech === 'Go')!;
    expect(go).toMatchObject({ capacity: '×1.6', latency: '×0.75' });
    expect(go).not.toHaveProperty('maxConnections');
    expect(byKind.db.technologies.find((t) => t.tech === 'Postgres')).toMatchObject({ maxConnections: 100 });
    expect(byKind.db.technologies.find((t) => t.tech === 'MySQL')).toMatchObject({ maxConnections: 151 });
    expect(byKind.db.technologies.find((t) => t.tech === 'MongoDB')).not.toHaveProperty('maxConnections');
    // kinds without profiles only list the name
    expect(byKind.cdn.technologies[0]).toEqual({ tech: 'Cloudflare' });
    expect(byKind.users.technologies[0]).toEqual({ tech: 'Web app' });
  });
});

describe('SIZE_TABLE', () => {
  test('one row per size with vCPU, RAM and cost', () => {
    expect(SIZE_TABLE.map((r) => r.size)).toEqual([...SIZE_VALUES]);
    SIZE_TABLE.forEach((r, i) => expect(r).toEqual({ size: SIZE_VALUES[i], vcpu: SIZES[i].cpu, ramGb: SIZES[i].ram, costPerMonthUsd: SIZES[i].cost }));
    expect(SIZE_TABLE[2]).toEqual({ size: '16vCPU', vcpu: 16, ramGb: 64, costPerMonthUsd: 600 });
  });
});

describe('DESIGN_GUIDE', () => {
  test('mentions the rules a model needs', () => {
    expect(DESIGN_GUIDE).toMatch(/^How to describe a SysLab design:/);
    for (const s of ['"users"', 'maxConnections', 'callsPerRequest', 'circuitBreaker', 'measured', 'update_design', 'async']) {
      expect(DESIGN_GUIDE).toContain(s);
    }
  });
});
