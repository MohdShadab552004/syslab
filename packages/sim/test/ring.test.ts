import { describe, expect, test } from 'vitest';
import { S, design } from './helpers';

const cass = (dbc: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
  S.makeNode('d', 'db', 100, 200, 'D', { tech: 'Cassandra', dbc, ...over });

describe('ring helpers', () => {
  test('only ring technologies are ring databases', () => {
    expect(S.isRingDb(cass())).toBe(true);
    expect(S.isRingDb(S.makeNode('p', 'db', 0, 0, 'P'))).toBe(false);
    expect(S.isRingDb({ kind: 'cache', tech: 'Cassandra' })).toBe(false);
  });

  test('consistency level → replicas waited for', () => {
    expect(S.consistencyCount('one', 3)).toBe(1);
    expect(S.consistencyCount('quorum', 3)).toBe(2);
    expect(S.consistencyCount('quorum', 5)).toBe(3);
    expect(S.consistencyCount('quorum', 4)).toBe(3);
    expect(S.consistencyCount('all', 5)).toBe(5);
  });

  test('ringConfig defaults and clamps', () => {
    // fresh node: 3 nodes, RF 3, QUORUM
    expect(S.ringConfig(cass())).toEqual({
      nodes: 3, rf: 3, cl: 'quorum', k: 2, wcl: 'quorum', kw: 2, down: 0, hot: 0, buckets: 1, partitionMb: 10, specRetry: true,
    });
    // older designs keep their server count: 2 shards × (1 + 2 replicas) = 6
    expect(S.ringConfig(cass({ shards: 2, replicas: 2 })).nodes).toBe(6);
    // RF can't exceed the nodes, nodes capped, failed nodes clamped
    expect(S.ringConfig(cass({ nodes: 4, rf: 5 })).rf).toBe(4);
    expect(S.ringConfig(cass({ nodes: 99 })).nodes).toBe(S.RING_MAX_NODES);
    expect(S.ringConfig(cass({ nodes: 5, downNodes: 9 })).down).toBe(5);
    expect(S.ringConfig(cass({ nodes: 5, downNodes: -2 })).down).toBe(0);
    expect(S.ringConfig(cass({ nodes: 5, rf: 1, consistency: 'all' }))).toMatchObject({ rf: 1, k: 1 });
    // a node saved before the ring fields existed
    const old = cass({ consistency: undefined, writeConsistency: undefined, downNodes: undefined, hotShare: undefined, buckets: undefined, partitionMb: undefined, specRetry: undefined });
    expect(S.ringConfig(old)).toMatchObject({ cl: 'quorum', wcl: 'quorum', down: 0, hot: 0, buckets: 1, partitionMb: 10, specRetry: true });
    // hot share is a percentage, capped; buckets are whole and capped
    expect(S.ringConfig(cass({ hotShare: 30, buckets: 4.4 }))).toMatchObject({ hot: 0.3, buckets: 4 });
    expect(S.ringConfig(cass({ hotShare: 200, buckets: 999, partitionMb: -5 }))).toMatchObject({ hot: 0.9, buckets: S.MAX_BUCKETS, partitionMb: 0 });
    expect(S.ringConfig(cass({ consistency: 'one', writeConsistency: 'all' }))).toMatchObject({ k: 1, kw: 3 });
  });

  test('work and capacity', () => {
    const r = S.ringConfig(cass({ nodes: 6, specRetry: false }));
    // 90% reads × 2 + 10% writes × 3
    expect(S.ringWork(r, 0.9)).toBeCloseTo(2.1, 9);
    expect(S.ringCapacity(r, 1000, 0.9)).toBeCloseTo(6000 / 2.1, 6);
    expect(S.ringCapacity({ ...r, down: 2 }, 1000, 0.9)).toBeCloseTo(4000 / 2.1, 6);
    expect(S.ringCapacity({ ...r, down: 6 }, 1000, 0.9)).toBe(0);
    // speculative retry sends about 1% of reads twice
    expect(S.ringWork({ ...r, specRetry: true }, 0.9)).toBeCloseTo(0.9 * 2 * 1.01 + 0.3, 9);
    // writes reach every replica whatever the write level
    expect(S.ringWork({ ...r, wcl: 'one', kw: 1 }, 0.9)).toBeCloseTo(2.1, 9);
  });

  test('wide partitions make reads dearer; bucketing splits them', () => {
    expect(S.readPenalty({ partitionMb: 100, buckets: 1 })).toBe(1);
    expect(S.readPenalty({ partitionMb: 300, buckets: 1 })).toBe(2);
    expect(S.readPenalty({ partitionMb: 300, buckets: 3 })).toBe(1);
    expect(S.effectivePartitionMb({ partitionMb: 300, buckets: 4 })).toBe(75);
    const r = S.ringConfig(cass({ nodes: 6, specRetry: false, partitionMb: 300 }));
    expect(S.ringWork(r, 0.9)).toBeCloseTo(0.9 * 2 * 2 + 0.3, 9);
    expect(S.ringLatencyFactor(r, 0.9)).toBeCloseTo(0.9 * 1.15 * 2 + 0.1 * 1.15, 9);
  });

  test('a hot partition loads its replicas, bucketing spreads it', () => {
    const r = S.ringConfig(cass({ nodes: 12, specRetry: false, hotShare: 30 }));
    expect(S.hotNodeCount(r)).toBe(3);
    const L = S.ringNodeLoads(r, 1000, 0.9, 1000);
    // hottest node: 2100 ops/s × (0.3/3 + 0.7/12)
    expect(L.opsHot).toBeCloseTo(2100 * (0.1 + 0.7 / 12), 6);
    expect(L.hotLoad).toBeCloseTo(L.opsHot / 1000, 9);
    expect(L.coldLoad).toBeCloseTo((2100 * 0.7) / 12 / 1000, 9);
    expect(L.hotLoad).toBeGreaterThan(L.coldLoad * 2);
    expect(L.drop).toBe(0);
    expect(L.cap).toBeCloseTo(1000 / (2.1 * (0.1 + 0.7 / 12)), 6);
    expect(L.readOps).toBeCloseTo(1.8 / 2.1, 9);
    // past the hot nodes' capacity only their share of operations is dropped
    const over = S.ringNodeLoads(r, 1000, 0.9, 5000);
    expect(over.hotLoad).toBeGreaterThan(1);
    expect(over.coldLoad).toBeLessThan(1);
    expect(over.drop).toBeCloseTo((3 * (over.hotLoad - 1)) / (3 * over.hotLoad + 9 * over.coldLoad), 9);
    // four buckets: the key is spread over 12 nodes, even again
    const b = S.ringConfig(cass({ nodes: 12, specRetry: false, hotShare: 30, buckets: 4 }));
    expect(S.hotNodeCount(b)).toBe(12);
    const E = S.ringNodeLoads(b, 1000, 0.9, 1000);
    expect(E.hotLoad).toBeCloseTo(E.coldLoad, 9);
    // even traffic: every live node is a "hot" node
    expect(S.hotNodeCount(S.ringConfig(cass({ nodes: 6, downNodes: 1 })))).toBe(5);
    // overloaded evenly
    expect(S.ringNodeLoads(S.ringConfig(cass({ nodes: 3 })), 100, 0.9, 1000).drop).toBeGreaterThan(0.5);
    // nothing live
    expect(S.ringNodeLoads(S.ringConfig(cass({ nodes: 3, downNodes: 3 })), 1000, 0.9, 10)).toMatchObject({ hotLoad: 9, drop: 1, cap: 0, hotNodes: 0 });
    expect(S.ringNodeLoads(S.ringConfig(cass({ nodes: 3, downNodes: 3 })), 1000, 0.9, 0)).toMatchObject({ hotLoad: 0, coldLoad: 0 });
    expect(S.ringNodeLoads(S.ringConfig(cass({ nodes: 3 })), 1000, 0.9, 0)).toMatchObject({ hotLoad: 0, drop: 0 });
    expect(S.ringNodeLoads(S.ringConfig(cass({ nodes: 3 })), 1000, 0, 10).readOps).toBe(0);
  });

  test('stale reads only when R + W <= RF', () => {
    expect(S.staleReadShare(3, 2, 2)).toBe(0);
    expect(S.staleReadShare(3, 1, 3)).toBe(0);
    // ONE / ONE on RF 3: the read hits one of the two replicas that did not ack
    expect(S.staleReadShare(3, 1, 1)).toBeCloseTo(2 / 3, 9);
    expect(S.staleReadShare(3, 1, 2)).toBeCloseTo(1 / 3, 9);
    expect(S.staleReadShare(5, 2, 2)).toBeCloseTo(3 / 10, 9);
  });

  test('reads and writes fail at their own consistency level', () => {
    const r = S.ringConfig(cass({ nodes: 6, downNodes: 2, consistency: 'one', writeConsistency: 'all' }));
    // reads at ONE survive; writes at ALL fail on every range touching a failed node
    expect(S.ringUnavailable(r, 0.9)).toBeCloseTo(0.1 * S.unavailableShare(6, 3, 3, 2), 9);
    expect(S.toleratedFailures(r)).toBe(0);
    expect(S.toleratedFailures({ rf: 3, k: 1 })).toBe(2);
  });

  test('unavailable share is the hypergeometric tail', () => {
    expect(S.unavailableShare(6, 3, 2, 0)).toBe(0);
    expect(S.unavailableShare(6, 3, 2, 6)).toBe(1);
    // QUORUM on RF 3 tolerates one failure
    expect(S.unavailableShare(6, 3, 2, 1)).toBe(0);
    // two down: ranges whose 3 replicas include both = C(4,1) / C(6,3) = 4 / 20
    expect(S.unavailableShare(6, 3, 2, 2)).toBeCloseTo(0.2, 9);
    expect(S.unavailableShare(9, 3, 2, 2)).toBeCloseTo(7 / 84, 9);
    // ONE survives until every replica is down
    expect(S.unavailableShare(6, 3, 1, 2)).toBe(0);
    // ALL loses any range touching a failed node
    expect(S.unavailableShare(6, 3, 3, 1)).toBeCloseTo(0.5, 9);
    expect(S.toleratedFailures({ rf: 3, k: 2 })).toBe(1);
    expect(S.toleratedFailures({ rf: 5, k: 1 })).toBe(4);
  });

  test('layout: a circle around the anchor, starting at the top, capped', () => {
    expect(S.ringRadius(4)).toBe(120);
    expect(S.ringRadius(12)).toBe(180);
    const pts = S.ringLayout(cass({ nodes: 4 }));
    expect(pts).toEqual([{ x: 100, y: 80 }, { x: 220, y: 200 }, { x: 100, y: 320 }, { x: -20, y: 200 }]);
    expect(S.ringLayout(cass({ nodes: 20 }))).toHaveLength(S.RING_MAX_SHOWN);
  });
});

describe('ring databases in the engine', () => {
  const doc = (dbc: Record<string, unknown>, read = 90, users = 12000) =>
    design({ read, users }, ['u', 'users'], ['a', 'app', { size: 4 }], ['d', 'db', { tech: 'Cassandra', dbc }])
      .edge('u', 'a').edge('a', 'd').doc;

  test('more nodes add capacity, higher RF costs it', () => {
    // same inflow, so capacity is the inverse of the load
    const cap = (dbc: Record<string, unknown>) => 1 / S.simulate(doc(dbc)).dbLoad.d.w;
    expect(cap({ nodes: 6 })).toBeCloseTo(cap({ nodes: 3 }) * 2, 6);
    expect(cap({ nodes: 6, rf: 5 })).toBeLessThan(cap({ nodes: 6 }));
    expect(cap({ nodes: 6, consistency: 'one' })).toBeGreaterThan(cap({ nodes: 6 }));
  });

  test('the ring is reported, and failed nodes fail rows past the tolerance', () => {
    const ok = S.simulate(doc({ nodes: 6, downNodes: 1 }));
    expect(ok.ring.d).toMatchObject({ nodes: 6, rf: 3, k: 2, down: 1, unavailable: 0 });
    expect(ok.dbLoad.d.w).toBe(ok.dbLoad.d.r);
    const bad = S.simulate(doc({ nodes: 6, downNodes: 2 }));
    expect(bad.ring.d.unavailable).toBeCloseTo(0.2, 9);
    expect(bad.errorRate).toBeGreaterThan(ok.errorRate);
    // every node down: nothing served
    const dead = S.simulate(doc({ nodes: 3, downNodes: 3 }));
    expect(dead.ring.d.unavailable).toBe(1);
    expect(dead.dbLoad.d.w).toBe(9);
    // no traffic at all, no capacity: load stays 0
    expect(S.simulate(doc({ nodes: 3, downNodes: 3 }, 90, 0)).dbLoad.d.w).toBe(0);
    // not a ring: nothing reported
    expect(S.simulate(design({}, ['u', 'users'], ['d', 'db']).edge('u', 'd').doc).ring).toEqual({});
  });

  test('stronger consistency is slower, for reads and writes apart', () => {
    const svc = (dbc: Record<string, unknown>, read = 90) => S.simulate(doc(dbc, read)).service.d;
    expect(svc({ consistency: 'one' })).toBeLessThan(svc({ consistency: 'quorum' }));
    expect(svc({ consistency: 'quorum' })).toBeLessThan(svc({ consistency: 'all' }));
    expect(svc({ writeConsistency: 'one' }, 10)).toBeLessThan(svc({ writeConsistency: 'all' }, 10));
    expect(S.serviceTime(cass())).toBeCloseTo(9 * 1.3 * 1.15 + 0.5, 6);
  });

  test('Unavailable fails fast, overload times out', () => {
    const two = S.simulate(doc({ nodes: 6, downNodes: 2 }));
    expect(two.fastFailRate).toBeCloseTo(two.errorRate, 6);
    // failing fast does not drag P95 to the timeout
    expect(two.p95).toBeLessThan(1000);
    const over = S.simulate(doc({ nodes: 3, specRetry: false }, 90, 400000));
    expect(over.errorRate).toBeGreaterThan(0.05);
    expect(over.fastFailRate).toBe(0);
  });

  test('a hot partition drops only what lands on its replicas', () => {
    const run = (dbc: Record<string, unknown>) => S.simulate(doc({ nodes: 12, ...dbc }, 90, 300000));
    const even = run({}), hot = run({ hotShare: 60 }), salted = run({ hotShare: 60, buckets: 4 });
    expect(hot.ring.d.hotNodes).toBe(3);
    // the reported ring keeps the hot-key share next to the node loads
    expect(hot.ring.d.hot).toBe(0.6);
    expect(hot.ring.d.hotLoad).toBeGreaterThan(hot.ring.d.coldLoad);
    expect(hot.load.d).toBeGreaterThan(even.load.d * 2);
    expect(hot.errorRate).toBeGreaterThan(even.errorRate);
    expect(salted.load.d).toBeCloseTo(even.load.d, 6);
  });

  test('speculative retry shortens the tail', () => {
    const p99 = (specRetry: boolean) => {
      const d = design({}, ['u', 'users'], ['d', 'db', { tech: 'Cassandra', dbc: { specRetry } }]).edge('u', 'd').doc;
      return S.simulate(d).p99;
    };
    expect(p99(true)).toBeLessThan(p99(false));
  });

  test('a ring db is not drawn as a primary/replica cluster and pays for every node', () => {
    expect(S.isDbCluster(cass({ shards: 2, replicas: 1 }))).toBe(false);
    const six = S.priceNode(cass({ nodes: 6 }), { rps: 0, sizeIdx: 2, reps: 1, read: 0.9, respKb: 10, assetKb: 100, storageGb: 500 });
    const three = S.priceNode(cass({ nodes: 3 }), { rps: 0, sizeIdx: 2, reps: 1, read: 0.9, respKb: 10, assetKb: 100, storageGb: 500 });
    expect(six.monthly).toBeGreaterThan(three.monthly * 1.5);
  });
});
