import { describe, expect, test } from 'vitest';
import { RING_MAX_SHOWN, ringRadius } from '@syslab/sim';
import { buildDesign } from '../src/build';
import { docToSpec } from '../src/readback';
import { simulationReport } from '../src/report';
import { DESIGN_GUIDE } from '../src/catalog';
import { layout } from '../src/layout';
import { c, nodeOf, spec } from './helpers';

const ring = (database: Record<string, unknown>, tech = 'Cassandra', users = 100_000) => buildDesign(spec({
  users,
  components: [c('Users', 'users'), c('LB', 'lb'), c('API', 'app', { size: '64vCPU', replicas: 3 }), c('Msgs', 'db', { tech, size: '16vCPU', database })],
  connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'API' }, { from: 'API', to: 'Msgs' }],
}));
const back = (r: ReturnType<typeof ring>) => docToSpec('x', r.doc).components.find((k) => k.name === 'Msgs')!.database;
const issues = (r: ReturnType<typeof ring>) => simulationReport(r.doc).issues.filter((i) => i.startsWith('Msgs:'));

describe('ring databases in the spec', () => {
  test('ring fields map to the node and read back', () => {
    const r = ring({ nodes: 6, replicationFactor: 3, consistency: 'one', failedNodes: 1 });
    expect(r.warnings).toEqual([]);
    // consistency sets reads and writes alike
    expect(nodeOf(r.doc, 'Msgs').dbc).toMatchObject({ nodes: 6, rf: 3, consistency: 'one', writeConsistency: 'one', downNodes: 1 });
    expect(back(r)).toEqual({ nodes: 6, replicationFactor: 3, consistency: 'one', failedNodes: 1 });
    // defaults are left out
    expect(back(ring({ nodes: 4 }))).toEqual({ nodes: 4, replicationFactor: 3, consistency: 'quorum' });
  });

  test('phase 1 fields: write level, hot key, buckets, partition size, speculative retry', () => {
    const r = ring({ nodes: 12, consistency: 'one', writeConsistency: 'all', hotKeyShare: 40, keyBuckets: 2, partitionMb: 300, speculativeRetry: false });
    expect(nodeOf(r.doc, 'Msgs').dbc).toMatchObject({ consistency: 'one', writeConsistency: 'all', hotShare: 40, buckets: 2, partitionMb: 300, specRetry: false });
    const db = back(r);
    expect(db).toEqual({ nodes: 12, replicationFactor: 3, consistency: 'one', writeConsistency: 'all', hotKeyShare: 40, keyBuckets: 2, partitionMb: 300, speculativeRetry: false });
    // round trip
    expect(nodeOf(buildDesign(docToSpec('x', r.doc)).doc, 'Msgs').dbc).toMatchObject({ consistency: 'one', writeConsistency: 'all', hotShare: 40, buckets: 2, partitionMb: 300, specRetry: false });
    // only a write level: reads keep the default
    expect(nodeOf(ring({ writeConsistency: 'one' }).doc, 'Msgs').dbc).toEqual({ writeConsistency: 'one' });
    expect(back(ring({ writeConsistency: 'one' }))).toMatchObject({ consistency: 'quorum', writeConsistency: 'one' });
  });

  test('ring fields on a non-ring database are ignored with a warning', () => {
    const r = ring({ nodes: 6, hotKeyShare: 20, shards: 2 }, 'Postgres');
    expect(r.warnings).toContain('nodes / hotKeyShare on "Msgs" only apply to ring databases (tech "Cassandra"); they were ignored.');
    // the other database settings still apply
    expect(nodeOf(r.doc, 'Msgs').dbc).toMatchObject({ shards: 2 });
    expect(back(r)).toMatchObject({ shards: 2 });
  });

  test('the report calls out failed nodes', () => {
    expect(issues(ring({ nodes: 6 }))).toEqual([]);
    expect(issues(ring({ nodes: 6, failedNodes: 1 }))).toEqual(['Msgs: 1 of 6 nodes down; every row still reaches QUORUM (RF 3).']);
    expect(issues(ring({ nodes: 6, failedNodes: 2 }))).toEqual([
      "Msgs: 2 of 6 nodes down, so 20% of requests can't reach their consistency level (RF 3 tolerates 1) and fail at once (UnavailableException). Bring nodes back, lower the consistency level or raise the replication factor.",
    ]);
  });

  test('the report calls out hot keys, wide partitions and stale reads', () => {
    const hot = issues(ring({ nodes: 12, hotKeyShare: 60 }, 'Cassandra', 1_000_000));
    expect(hot[0]).toMatch(/^Msgs: hot partition\. 60% of traffic hits one key, so its 3 replica nodes run at \d+% while the rest run at \d+% and drop \d+% of operations \(timeouts\)\. Salt the key/);
    expect(issues(ring({ nodes: 12, hotKeyShare: 60 }))[0]).toMatch(/run at \d+%\. Salt the key/);
    expect(issues(ring({ nodes: 12, hotKeyShare: 60, keyBuckets: 4 }))).toEqual([]);
    expect(issues(ring({ nodes: 6, partitionMb: 500 }))).toEqual(['Msgs: partitions of 500 MB make every read 3.0× dearer and slow compaction and repair. Keep them under 100 MB (bucket the key).']);
    expect(issues(ring({ nodes: 6, consistency: 'one' }))).toEqual(['Msgs: reads at ONE (1) + writes at ONE (1) ≤ RF 3, so up to 67% of reads right after a write miss it. Raise either level until R + W > RF.']);
    expect(issues(ring({ nodes: 6, consistency: 'one', writeConsistency: 'all' }))).toEqual([]);
  });

  test('a ring without enough replicas fails fast in the report', () => {
    const r = simulationReport(ring({ nodes: 3, failedNodes: 2, consistency: 'all' }).doc);
    expect(r.text).toMatch(/\d+% failed fast \(an open circuit breaker, or a ring without enough live replicas\)/);
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
    expect(DESIGN_GUIDE).toContain('keyBuckets');
  });
});
