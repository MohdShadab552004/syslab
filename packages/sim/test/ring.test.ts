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
    expect(S.ringConfig(cass())).toEqual({ nodes: 3, rf: 3, cl: 'quorum', k: 2, down: 0 });
    // older designs keep their server count: 2 shards × (1 + 2 replicas) = 6
    expect(S.ringConfig(cass({ shards: 2, replicas: 2 })).nodes).toBe(6);
    // RF can't exceed the nodes, nodes capped, failed nodes clamped
    expect(S.ringConfig(cass({ nodes: 4, rf: 5 })).rf).toBe(4);
    expect(S.ringConfig(cass({ nodes: 99 })).nodes).toBe(S.RING_MAX_NODES);
    expect(S.ringConfig(cass({ nodes: 5, downNodes: 9 })).down).toBe(5);
    expect(S.ringConfig(cass({ nodes: 5, downNodes: -2 })).down).toBe(0);
    expect(S.ringConfig(cass({ nodes: 5, rf: 1, consistency: 'all' }))).toMatchObject({ rf: 1, k: 1 });
    // a node saved before the ring fields existed
    const old = cass();
    delete old.dbc.consistency; delete old.dbc.downNodes;
    expect(S.ringConfig(old)).toMatchObject({ cl: 'quorum', down: 0 });
  });

  test('work and capacity', () => {
    const r = S.ringConfig(cass({ nodes: 6 }));
    // 90% reads × 2 + 10% writes × 3
    expect(S.ringWork(r, 0.9)).toBeCloseTo(2.1, 9);
    expect(S.ringCapacity(r, 1000, 0.9)).toBeCloseTo(6000 / 2.1, 6);
    expect(S.ringCapacity({ ...r, down: 2 }, 1000, 0.9)).toBeCloseTo(4000 / 2.1, 6);
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

  test('stronger consistency is slower', () => {
    const svc = (cl: string) => S.simulate(doc({ consistency: cl })).service.d;
    expect(svc('one')).toBeLessThan(svc('quorum'));
    expect(svc('quorum')).toBeLessThan(svc('all'));
  });

  test('a ring db is not drawn as a primary/replica cluster and pays for every node', () => {
    expect(S.isDbCluster(cass({ shards: 2, replicas: 1 }))).toBe(false);
    const six = S.priceNode(cass({ nodes: 6 }), { rps: 0, sizeIdx: 2, reps: 1, read: 0.9, respKb: 10, assetKb: 100, storageGb: 500 });
    const three = S.priceNode(cass({ nodes: 3 }), { rps: 0, sizeIdx: 2, reps: 1, read: 0.9, respKb: 10, assetKb: 100, storageGb: 500 });
    expect(six.monthly).toBeGreaterThan(three.monthly * 1.5);
  });
});
