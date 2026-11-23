import { describe, expect, test } from 'vitest';
import { RING_MAX_SHOWN, ringRadius } from '@syslab/sim';
import { buildDesign } from '../src/build';
import { docToSpec } from '../src/readback';
import { simulationReport } from '../src/report';
import { DESIGN_GUIDE } from '../src/catalog';
import { layout } from '../src/layout';
import { c, nodeOf, spec } from './helpers';

const ring = (database: Record<string, unknown>, tech = 'Cassandra') => buildDesign(spec({
  users: 100_000,
  components: [c('Users', 'users'), c('LB', 'lb'), c('API', 'app', { size: '64vCPU', replicas: 3 }), c('Msgs', 'db', { tech, size: '16vCPU', database })],
  connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'API' }, { from: 'API', to: 'Msgs' }],
}));

describe('ring databases in the spec', () => {
  test('ring fields map to the node and read back', () => {
    const r = ring({ nodes: 6, replicationFactor: 3, consistency: 'one', failedNodes: 1 });
    expect(r.warnings).toEqual([]);
    expect(nodeOf(r.doc, 'Msgs').dbc).toMatchObject({ nodes: 6, rf: 3, consistency: 'one', downNodes: 1 });
    const back = docToSpec('x', r.doc).components.find((k) => k.name === 'Msgs')!;
    expect(back.database).toEqual({ nodes: 6, replicationFactor: 3, consistency: 'one', failedNodes: 1 });
    // no failed nodes: the field is left out
    const ok = docToSpec('x', ring({ nodes: 4 }).doc).components.find((k) => k.name === 'Msgs')!;
    expect(ok.database).toEqual({ nodes: 4, replicationFactor: 3, consistency: 'quorum' });
  });

  test('ring fields on a non-ring database are ignored with a warning', () => {
    const r = ring({ nodes: 6, shards: 2 }, 'Postgres');
    expect(r.warnings).toContain('nodes / replicationFactor / consistency on "Msgs" only apply to ring databases (tech "Cassandra"); they were ignored.');
    // the other database settings still apply
    expect(nodeOf(r.doc, 'Msgs').dbc).toMatchObject({ shards: 2 });
    expect(docToSpec('x', r.doc).components.find((k) => k.name === 'Msgs')!.database).toMatchObject({ shards: 2 });
  });

  test('the report calls out failed nodes', () => {
    expect(simulationReport(ring({ nodes: 6 }).doc).issues.join('\n')).not.toMatch(/nodes down/);
    expect(simulationReport(ring({ nodes: 6, failedNodes: 1 }).doc).issues).toContain('Msgs: 1 of 6 nodes down; every row still reaches QUORUM (RF 3).');
    const bad = simulationReport(ring({ nodes: 6, failedNodes: 2 }).doc).issues.find((i) => i.startsWith('Msgs: 2 of 6'));
    expect(bad).toBe("Msgs: 2 of 6 nodes down, so 20% of rows can't reach QUORUM (RF 3 tolerates 1). Bring nodes back, lower the consistency level or raise the replication factor.");
  });

  test('the layout leaves room for the ring all around', () => {
    for (const nodes of [3, 20]) {
      const d = ring({ nodes }).doc;
      const p = layout(d.nodes, d.edges, []).nodes.get(nodeOf(d, 'Msgs').id)!;
      const r = ringRadius(Math.min(nodes, RING_MAX_SHOWN)) + 45;
      expect([p.left, p.right, p.top, p.bottom].every((x) => x >= r)).toBe(true);
    }
  });

  test('the guide mentions rings', () => {
    expect(DESIGN_GUIDE).toContain('Cassandra is a leaderless ring');
  });
});
