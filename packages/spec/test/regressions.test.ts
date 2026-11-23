import { describe, expect, test } from 'vitest';
import { blankDoc, makeNode } from '@syslab/sim';
import { buildDesign } from '../src/build';
import { docToSpec } from '../src/readback';
import { simulationReport } from '../src/report';
import { c, spec } from './helpers';

/** Bugs found while writing the coverage tests; each one stays fixed. */
describe('regressions', () => {
  test('two blank labels read back as "App Server" and "App Server (2)"', () => {
    const doc = blankDoc({ nodes: [makeNode('a', 'app', 0, 0, ''), makeNode('b', 'app', 0, 0, '')] });
    expect(docToSpec('x', doc).components.map((x) => x.name)).toEqual(['App Server', 'App Server (2)']);
  });

  test('a long name never gives an id ending in "-"', () => {
    const { doc } = buildDesign(spec({ components: [c('Users', 'users'), c('abcdefghijklmnopqrstuvw xyz', 'app')] }));
    const id = doc.nodes[1].id;
    expect(id).toBe('n_abcdefghijklmnopqrstuvw');
    expect(id.endsWith('-')).toBe(false);
  });

  test('a nested group family never wraps an unrelated group', () => {
    const { doc } = buildDesign(spec({
      components: [c('Users', 'users'), c('X', 'app'), c('Y', 'app'), c('Z', 'app')],
      connections: [{ from: 'Users', to: 'X' }, { from: 'Users', to: 'Y' }, { from: 'Users', to: 'Z' }],
      groups: [{ name: 'Outer', members: ['X', 'Y'] }, { name: 'Other', members: ['Z'] }, { name: 'Inner', members: ['X'] }],
    }));
    const back = docToSpec('x', doc);
    expect(back.groups!.find((g) => g.name === 'Outer')!.members.sort()).toEqual(['X', 'Y']);
    expect(back.groups!.find((g) => g.name === 'Other')!.members).toEqual(['Z']);
    expect(back.groups!.find((g) => g.name === 'Inner')!.members).toEqual(['X']);
  });

  test('the far sub-column drops half a row so lines pass between the near nodes', () => {
    const names = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
    const { doc } = buildDesign(spec({
      components: [c('Users', 'users'), c('Gateway', 'gateway'), ...names.map((n) => c(n, 'app'))],
      connections: [{ from: 'Users', to: 'Gateway' }, ...names.map((n) => ({ from: 'Gateway', to: n }))],
    }));
    const pos = names.map((n) => doc.nodes.find((x) => x.label === n)!);
    const xs = [...new Set(pos.map((p) => p.x))].sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    const near = pos.filter((p) => p.x === xs[0]).map((p) => p.y).sort((a, b) => a - b);
    const far = pos.filter((p) => p.x === xs[1]).map((p) => p.y).sort((a, b) => a - b);
    const row = near[1] - near[0];
    expect(Math.abs(far[0] - near[0] - row / 2)).toBeLessThanOrEqual(10);
  });

  test('when a breaker rejects requests, the latency line says so', () => {
    const { doc } = buildDesign(spec({
      users: 30000,
      components: [c('Users', 'users'), c('API', 'app', { size: '64vCPU' }), c('Pay', 'ext', { tech: 'Payment gateway' })],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Pay', circuitBreaker: true }],
    }));
    const r = simulationReport(doc, { seconds: 3 });
    expect(r.errorRatePercent).toBeGreaterThan(50);
    expect(r.text).toMatch(/Latency only counts answered requests: \d+% were rejected instantly by an open circuit breaker\./);
  });
});

describe('sizes used for the cost', () => {
  test('the spec sets them, readback returns them, and the report prices with them', () => {
    const base = { components: [c('Users', 'users'), c('API', 'app'), c('Files', 'store')], connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Files', callsPerRequest: 1 }] };
    const sized = buildDesign(spec({ ...base, avgResponseKb: 2, avgFileKb: 500, storageGb: 50 }));
    expect(sized.doc.requirements).toMatchObject({ respKb: 2, assetKb: 500, storageGb: 50 });
    const back = docToSpec('x', sized.doc);
    expect(back).toMatchObject({ avgResponseKb: 2, avgFileKb: 500, storageGb: 50 });
    const plain = buildDesign(spec(base));
    expect(plain.doc.requirements.respKb).toBeUndefined();
    expect(docToSpec('x', plain.doc)).not.toHaveProperty('avgResponseKb');
    // smaller replies and less stored data cost less
    expect(simulationReport(sized.doc, { seconds: 0 }).monthlyCostUsd).toBeLessThan(simulationReport(plain.doc, { seconds: 0 }).monthlyCostUsd);
  });

  test('the report lists categories and savings only when there are some', () => {
    const free = buildDesign(spec({ components: [c('Users', 'users'), c('Pay', 'ext', { tech: 'Payment gateway' })], connections: [{ from: 'Users', to: 'Pay' }] }));
    const r = simulationReport(free.doc, { seconds: 0 });
    expect(r.text).not.toContain('Ways to save');
    expect(r.cost.savings).toEqual([]);
    expect(r.cost.topItems.map((i) => i.component)).toEqual(['Data transfer out']);
  });
});
