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
