import { describe, expect, test } from 'vitest';
import { S, design, run } from './helpers';

const rt0 = (over = {}) => ({ ...S.EMPTY_RUNTIME, ...over });

describe('helpers', () => {
  test('isOver: exactly 100% (or a hair above) is busy, not overloaded', () => {
    expect(S.isOver(1)).toBe(false);
    expect(S.isOver(S.OVERLOAD)).toBe(false);
    expect(S.isOver(1.01)).toBe(true);
  });

  test('isBalancer / isHorizontalAuto / isVerticalAuto', () => {
    expect(S.isBalancer(undefined)).toBe(false);
    expect(S.isBalancer(S.makeNode('l', 'lb', 0, 0, 'l'))).toBe(true);
    expect(S.isBalancer(S.makeNode('g', 'gateway', 0, 0, 'g'))).toBe(true);
    expect(S.isBalancer(S.makeNode('a', 'app', 0, 0, 'a'))).toBe(false);
    const h = S.makeNode('a', 'app', 0, 0, 'a', { autoscale: S.autoH(1, 2) });
    const v = S.makeNode('a', 'app', 0, 0, 'a', { autoscale: S.autoV(0, 2) });
    expect([!!S.isHorizontalAuto(h), !!S.isVerticalAuto(h)]).toEqual([true, false]);
    expect([!!S.isHorizontalAuto(v), !!S.isVerticalAuto(v)]).toEqual([false, true]);
    expect(!!S.isHorizontalAuto(S.makeNode('d', 'db', 0, 0, 'd', { autoscale: S.autoH(1, 2) }))).toBe(false);
  });

  test('capacityPerInstance: users are unlimited, unsized kinds use a fixed capacity × technology', () => {
    expect(S.capacityPerInstance(S.makeNode('u', 'users', 0, 0, 'u'))).toBe(Infinity);
    expect(S.capacityPerInstance(S.makeNode('l', 'lb', 0, 0, 'l', { tech: 'HAProxy' }))).toBeCloseTo(120000 * 1.2, 6);
    expect(S.capacityPerInstance(S.makeNode('d', 'db', 0, 0, 'd', { size: 1 }))).toBe(120 * 8);
    expect(S.capacityPerInstance(S.makeNode('d', 'db', 0, 0, 'd', { size: 1 }), 3)).toBe(120 * 64);
    // a measured number on an unsized kind does not scale
    expect(S.capacityPerInstance(S.makeNode('x', 'ext', 0, 0, 'x', { measured: { rps: 250 } }), 4)).toBe(250);
    // non-positive measurements are ignored
    expect(S.capacityPerInstance(S.makeNode('a', 'app', 0, 0, 'a', { measured: { rps: 0, ms: -1 } }))).toBe(150 * 16);
    expect(S.serviceTime(S.makeNode('a', 'app', 0, 0, 'a', { measured: { rps: 0, ms: -1 } }))).toBe(38);
  });

  test('serviceTime of a database depends on partitioning, sync replicas and range sharding', () => {
    const db = (dbc) => S.serviceTime(S.makeNode('d', 'db', 0, 0, 'd', { dbc }));
    expect(S.serviceTime(S.makeNode('u', 'users', 0, 0, 'u'))).toBe(0);
    expect(db({})).toBe(9);
    expect(db({ partition: 'time' })).toBeCloseTo(6.3, 12);
    expect(db({ sync: true, replicas: 2 })).toBe(15);
    expect(db({ sync: true, replicas: 0 })).toBe(9);
    expect(db({ shards: 4, strategy: 'range' })).toBe(10);
    expect(db({ shards: 4, strategy: 'hash' })).toBe(9);
    expect(db({ shards: 1, strategy: 'range' })).toBe(9);
    expect(db({ partition: 'time', sync: true, replicas: 1, shards: 2, strategy: 'range' })).toBeCloseTo(6.3 + 6 + 1, 12);
    expect(S.serviceTime(S.makeNode('d', 'db', 0, 0, 'd', { tech: 'Cassandra' }))).toBeCloseTo(9 * 1.3, 12);
  });

  test('dbConnLimit: explicit max connections, the technology default, or no limit', () => {
    expect(S.dbConnLimit(S.makeNode('d', 'db', 0, 0, 'd'))).toBe(100);
    expect(S.dbConnLimit(S.makeNode('d', 'db', 0, 0, 'd', { tech: 'MySQL' }))).toBe(151);
    expect(S.dbConnLimit(S.makeNode('d', 'db', 0, 0, 'd', { tech: 'MongoDB' }))).toBeNull();
    expect(S.dbConnLimit(S.makeNode('d', 'db', 0, 0, 'd', { tech: 'MongoDB', dbc: { maxConn: 500 } }))).toBe(500);
  });

  test('latencyAt: past 100% the wait climbs with the overload, up to the timeout', () => {
    const base = S.latencyAt(10, 20, 1.5) - 500;
    expect(base).toBeCloseTo(20 + S.queueTimes(10, 20, 1.5).meanWait, 9);
    expect(S.latencyAt(10, 20, 3)).toBeCloseTo(base + S.TIMEOUT_MS, 9);
    expect(S.latencyAt(10, 20, 0)).toBe(20);
  });
});

describe('queueing', () => {
  test('no service time, no load or infinite load means no queue', () => {
    const zero = { pWait: 0, meanWait: 0, p95Wait: 0, p99Wait: 0 };
    expect(S.queueTimes(4, 0, 0.5)).toEqual(zero);
    expect(S.queueTimes(4, 10, 0)).toEqual(zero);
    expect(S.queueTimes(4, 10, Infinity)).toEqual(zero);
    expect(S.queueTimes(4, 10, NaN)).toEqual(zero);
  });

  test('utilisation is capped just below 100%', () => {
    expect(S.queueTimes(2, 10, 5)).toEqual(S.queueTimes(2, 10, 0.995));
    expect(S.queueTimes(2, 10, 5).pWait).toBeLessThan(1);
  });

  test('quantiles are zero when few requests wait', () => {
    const q = S.queueTimes(100, 10, 0.3);
    expect(q.pWait).toBeLessThan(0.01);
    expect(q.p95Wait).toBe(0);
    expect(q.p99Wait).toBe(0);
  });

  test('fractional and tiny worker counts round to at least one worker', () => {
    expect(S.queueTimes(0.2, 10, 0.5)).toEqual(S.queueTimes(1, 10, 0.5));
    expect(S.queueTimes(2.4, 10, 0.5)).toEqual(S.queueTimes(2, 10, 0.5));
  });

  test('workersFor: Little\'s law, at least one worker', () => {
    expect(S.workersFor(2400, 38)).toBe(91);
    expect(S.workersFor(10, 1)).toBe(1);
    expect(S.workersFor(Infinity, 10)).toBe(1);
    expect(S.workersFor(0, 10)).toBe(1);
    expect(S.workersFor(100, 0)).toBe(1);
  });

  test('service-time tail multipliers', () => {
    expect(S.SERVICE_P95).toBeLessThan(S.SERVICE_P99);
  });
});

describe('graph shape', () => {
  test('a cycle does not hang the simulation and every node still gets a result', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['a', 'app'], ['b', 'app']).edge('u', 'a').edge('a', 'b').edge('b', 'a');
    const s = S.simulate(d.doc);
    expect(s.inflow.a).toBeGreaterThanOrEqual(s.rps);
    expect(s.inflow.b).toBe(s.rps);
    expect(s.errorRate).toBe(0);
    for (const k of ['meanLatency', 'p95', 'p99']) expect(Number.isFinite(s[k])).toBe(true);
    expect(s.nodeLatency.b).toBeGreaterThan(0);
  });

  test('self-loops and edges to missing nodes are ignored', () => {
    const clean = design({ users: 12000 }, ['u', 'users'], ['a', 'app']).edge('u', 'a');
    const messy = design({ users: 12000 }, ['u', 'users'], ['a', 'app']).edge('u', 'a').edge('a', 'a').edge('a', 'ghost').edge('ghost', 'a');
    const c = S.simulate(clean.doc), m = S.simulate(messy.doc);
    expect(m.inflow).toEqual(c.inflow);
    expect(m.meanLatency).toBe(c.meanLatency);
    expect(m.errorRate).toBe(0);
  });

  test('no traffic source: no latency and no errors', () => {
    const lone = design({ users: 12000 }, ['a', 'app']);
    expect(S.simulate(lone.doc)).toMatchObject({ meanLatency: 0, p95: 0, p99: 0, errorRate: 0, fastFailRate: 0 });
    const idle = design({ users: 12000 }, ['u', 'users'], ['a', 'app']);
    expect(S.simulate(idle.doc)).toMatchObject({ meanLatency: 0, p95: 0, p99: 0, errorRate: 0 });
  });

  test('a users node alone still has a client round trip on the slow path', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['a', 'app']).edge('u', 'a');
    const s = S.simulate(d.doc);
    expect(s.meanLatency).toBeCloseTo(S.CLIENT_RTT_MS + S.HOP_MS + s.nodeLatency.a, 9);
    expect(s.onSlowPath).toEqual({ e1: true });
  });
});

describe('traffic', () => {
  test('a spike multiplies traffic; a spike of 0 is treated as off', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['a', 'app']).edge('u', 'a');
    expect(S.simulate(d.doc, rt0({ spike: 3 })).rps).toBeCloseTo(3000 * S.RPS_PER_USER, 9);
    expect(S.simulate(d.doc, rt0({ spike: 0 })).rps).toBeCloseTo(1000 * S.RPS_PER_USER, 9);
    expect(S.simulate(d.doc, rt0({ spike: 3 })).users).toBe(3000);
  });

  test('a doc without requirements assumes 90% reads', () => {
    const d = design({ users: 60000, read: 90 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache'], ['db', 'db', { size: 4 }])
      .edge('u', 'api').edge('api', 'c').edge('api', 'db');
    const withReq = S.simulate(d.doc);
    const noReq = S.simulate({ ...d.doc, requirements: undefined });
    expect(noReq.inflow).toEqual(withReq.inflow);
  });

  test('weight 0 on a plain connection counts as 1', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['a', 'app'], ['b', 'app'])
      .edge('u', 'api').edge('api', 'a', { weight: 0 }).edge('api', 'b', { weight: 1 });
    const s = S.simulate(d.doc);
    expect(s.inflow.a).toBeCloseTo(s.rps / 2, 9);
    expect(s.inflow.b).toBeCloseTo(s.rps / 2, 9);
  });

  test('weights that cancel out send nothing instead of dividing by zero', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['a', 'app'], ['b', 'app'])
      .edge('u', 'api').edge('api', 'a', { weight: 1 }).edge('api', 'b', { weight: -1 });
    const s = S.simulate(d.doc);
    expect(s.inflow.a).toBe(0);
    expect(s.inflow.b).toBe(0);
    expect(Number.isFinite(s.meanLatency)).toBe(true);
  });

  test('fan-out connections get every request; the others split what is left by weight', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['f', 'app', { size: 4 }], ['a', 'app', { size: 4 }], ['b', 'app', { size: 4 }])
      .edge('u', 'api').edge('api', 'f', { calls: 2 }).edge('api', 'a').edge('api', 'b', { weight: 3 });
    const s = S.simulate(d.doc);
    expect(s.inflow.f).toBeCloseTo(s.rps * 2, 9);
    expect(s.inflow.a).toBeCloseTo(s.rps / 4, 9);
    expect(s.inflow.b).toBeCloseTo((s.rps * 3) / 4, 9);
  });

  test('replicas without a load balancer: the node asks for one and serves as a single instance', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['a', 'app', { replicas: 3 }]).edge('u', 'a');
    const s = S.simulate(d.doc);
    expect(s.needsLB.a).toBe(true);
    expect(s.reps.a).toBe(1);
  });

  test('a node fed directly with replicas spreads traffic evenly over them', () => {
    // a queue feeds the workers, so they need no load balancer
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['q', 'queue'], ['w', 'worker', { replicas: 3 }], ['db', 'db', { size: 4 }])
      .edge('u', 'api').edge('api', 'q', { mode: 'async' }).edge('q', 'w', { mode: 'async' }).edge('w', 'db');
    const s = S.simulate(d.doc);
    expect(s.reps.w).toBe(3);
    expect(s.repLoad.w[0]).toBeCloseTo(s.repLoad.w[2], 12);
    expect(s.repLoad.w).toHaveLength(3);
  });
});

describe('databases', () => {
  const dbDesign = (read, dbc) =>
    design({ users: 12000, read }, ['u', 'users'], ['api', 'app'], ['db', 'db', { size: 2, dbc }]).edge('u', 'api').edge('api', 'db');

  test('read replicas: all reads go to the replicas', () => {
    const s = S.simulate(dbDesign(100, { replicas: 2 }).doc);
    const base = 120 * 16; // one primary, 16 vCPU
    expect(s.cap.db).toBe(base * 2);
    expect(s.dbLoad.db.w).toBe(0);
    expect(s.dbLoad.db.r).toBeCloseTo(s.inflow.db / (base * 2), 12);
  });

  test('read replicas: a write-only workload is limited by the primary', () => {
    const s = S.simulate(dbDesign(0, { replicas: 2 }).doc);
    expect(s.cap.db).toBe(120 * 16);
    expect(s.dbLoad.db.r).toBe(0);
    expect(s.dbLoad.db.w).toBeCloseTo(s.inflow.db / (120 * 16), 12);
  });

  test('read replicas: capacity is the tighter of the write and read limits', () => {
    const s = S.simulate(dbDesign(90, { replicas: 1 }).doc);
    const base = 120 * 16;
    expect(s.cap.db).toBeCloseTo(Math.min(base / 0.1, base / 0.9), 9);
  });

  test('shards multiply capacity and connection limits', () => {
    const s = S.simulate(dbDesign(90, { shards: 3 }).doc);
    expect(s.cap.db).toBe(120 * 16 * 3);
    expect(s.dbConns.db).toEqual({ need: 10, limit: 300 });
  });

  test('a database with no shards has no capacity', () => {
    const plain = S.simulate(dbDesign(90, { shards: 0 }).doc);
    expect(plain.cap.db).toBe(0);
    expect(plain.dbLoad.db).toEqual({ w: 0, r: 0 });
    expect(plain.load.db).toBe(9);
    expect(plain.errorRate).toBe(1);
    const repl = S.simulate(dbDesign(90, { shards: 0, replicas: 1 }).doc);
    expect(repl.dbLoad.db).toEqual({ w: 0, r: 0 });
  });

  test('async producers, offline callers and non-compute callers hold no connections', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['lb', 'lb'], ['api', 'app', { replicas: 4 }], ['off', 'app', { down: true }], ['db', 'db', { size: 3 }])
      .edge('u', 'lb').edge('lb', 'api').edge('lb', 'off').edge('api', 'db').edge('off', 'db').edge('lb', 'db').edge('api', 'db', { mode: 'async' });
    expect(S.simulate(d.doc).dbConns.db).toEqual({ need: 40, limit: 100 });
  });

  test('a database nobody connects to has no connection record', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['db', 'db']).edge('u', 'db');
    expect(S.simulate(d.doc).dbConns.db).toBeUndefined();
  });
});

describe('queues', () => {
  const qDesign = (users, wOver = {}, qOver = {}) =>
    design({ users }, ['u', 'users'], ['api', 'app', { size: 4 }], ['q', 'queue', { queuec: { mode: 'work' }, ...qOver }], ['w', 'worker', { size: 0, ...wOver }])
      .edge('u', 'api').edge('api', 'q', { mode: 'async' }).edge('q', 'w', { mode: 'async' });

  test('a consumer that keeps up drains everything as it arrives', () => {
    const s = S.simulate(qDesign(1000).doc);
    // 60 msg/s into a 120 msg/s worker
    expect(s.queue.q).toEqual({ depth: 0, inRate: 60, outRate: 60, drainCap: 120, growth: 0, full: false, consumers: 1, mode: 'work', subscribers: [] });
  });

  test('backlog drains at the consumer rate', () => {
    const s = S.simulate(qDesign(1000).doc, rt0({ qDepth: { q: 500 } }));
    expect(s.queue.q.outRate).toBe(120);
    expect(s.queue.q.growth).toBe(-60);
  });

  test('a full queue rejects what it cannot hold, and those requests fail', () => {
    const s = S.simulate(qDesign(60000).doc, rt0({ qDepth: { q: S.QUEUE_MAX } }));
    // 3600 msg/s in, the worker takes 120
    expect(s.queue.q.full).toBe(true);
    expect(s.queue.q.growth).toBe(0);
    expect(s.dropFrac.q).toBeCloseTo(3480 / 3600, 12);
    expect(s.errorRate).toBeCloseTo(3480 / 3600, 9);
  });

  test('a full queue that is draining rejects nothing', () => {
    const s = S.simulate(qDesign(1000).doc, rt0({ qDepth: { q: S.QUEUE_MAX } }));
    expect(s.queue.q.full).toBe(true);
    expect(s.dropFrac.q).toBe(0);
  });

  test('with no live consumer, nothing is pulled and everything waits', () => {
    const s = S.simulate(qDesign(1000, { down: true }).doc);
    expect(s.queue.q).toMatchObject({ outRate: 0, drainCap: 0, growth: 60, consumers: 0 });
    expect(s.inflow.w).toBe(0);
    expect(s.errorRate).toBe(0);
    expect(run(qDesign(1000, { down: true }).doc, 3).sim.queue.q.depth).toBe(180); // three ticks × 60
  });

  test('an offline queue passes nothing on', () => {
    const s = S.simulate(qDesign(1000, {}, { down: true }).doc);
    expect(s.queue.q.outRate).toBe(0);
    expect(s.inflow.w).toBe(0);
    expect(s.errorRate).toBe(1);
  });

  test('competing consumers pull in proportion to their capacity; a database consumer counts every shard', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['q', 'queue', { queuec: { mode: 'work' } }], ['w', 'worker', { size: 0 }], ['db', 'db', { size: 0, dbc: { shards: 2 } }])
      .edge('u', 'api').edge('api', 'q', { mode: 'async' }).edge('q', 'w', { mode: 'async' }).edge('q', 'db', { mode: 'async' });
    const s = S.simulate(d.doc);
    const wCap = 120, dbCap = 240 * 2;
    expect(s.queue.q.drainCap).toBe(wCap + dbCap);
    expect(s.inflow.w).toBeCloseTo(60 * wCap / (wCap + dbCap), 9);
    expect(s.inflow.db).toBeCloseTo(60 * dbCap / (wCap + dbCap), 9);
  });

  test('a consumer with unlimited capacity takes everything', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['q', 'queue', { queuec: { mode: 'work' } }], ['w', 'worker'], ['x', 'users'])
      .edge('u', 'api').edge('api', 'q', { mode: 'async' }).edge('q', 'w', { mode: 'async' }).edge('q', 'x', { mode: 'async' });
    const s = S.simulate(d.doc);
    expect(s.queue.q.drainCap).toBe(Infinity);
    expect(s.edgeRps.e3).toBe(0);
    expect(s.edgeRps.e4).toBe(60);
  });
});

describe('caches', () => {
  test('cache-aside with a write-only db connection still sends the misses to that db', () => {
    const d = design({ users: 60000, read: 90 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache'], ['db', 'db', { size: 4 }])
      .edge('u', 'api').edge('api', 'c').edge('api', 'db', { op: 'write' });
    const s = S.simulate(d.doc);
    const reads = s.rps * 0.9;
    expect(s.inflow.db).toBeCloseTo(reads * 0.1 + s.rps * 0.1, 6);
  });

  test('cache-aside with separate read and write databases', () => {
    const d = design({ users: 60000, read: 80 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache'], ['r', 'db', { size: 4 }], ['w', 'db', { size: 4 }])
      .edge('u', 'api').edge('api', 'c').edge('api', 'r', { op: 'read' }).edge('api', 'w', { op: 'write' });
    const s = S.simulate(d.doc);
    expect(s.inflow.r).toBeCloseTo(s.rps * 0.8 * 0.1, 6);
    expect(s.inflow.w).toBeCloseTo(s.rps * 0.2, 6);
    expect(s.cacheRefill.c).toBe(true);
  });

  test('cache-aside: other connections keep their share by weight', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache'], ['db', 'db', { size: 4 }], ['x', 'ext'])
      .edge('u', 'api').edge('api', 'c').edge('api', 'db').edge('api', 'x', { weight: 2 });
    const s = S.simulate(d.doc);
    expect(s.inflow.x).toBeCloseTo(s.rps / 2, 9);
    expect(s.inflow.c).toBeCloseTo((s.rps / 2) * 0.9, 9);
  });

  test('cache-aside with the read db offline: the cache cannot refill', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache'], ['db', 'db', { down: true }])
      .edge('u', 'api').edge('api', 'c').edge('api', 'db');
    expect(S.simulate(d.doc).cacheRefill.c).toBe(false);
  });

  test('an offline cache with nothing behind it fails the reads sent to it', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['c', 'cache', { down: true }]).edge('u', 'api').edge('api', 'c');
    const s = S.simulate(d.doc);
    expect(s.cacheBypass.c).toBeUndefined();
    expect(s.dropFrac.c).toBe(1);
    expect(s.errorRate).toBe(1);
    expect(s.nodeLatency.c).toBe(2);
  });

  test('an offline read-through cache that gets no traffic does not count as dropping', () => {
    const d = design({ users: 0 }, ['u', 'users'], ['api', 'app'], ['c', 'cache', { down: true }], ['db', 'db']).edge('u', 'api').edge('api', 'c').edge('c', 'db');
    const s = S.simulate(d.doc);
    expect(s.cacheBypass.c).toBe(true);
    expect(s.dropFrac.c).toBe(0);
  });

  test('an offline node with no traffic counts as dropping everything', () => {
    const d = design({ users: 0 }, ['u', 'users'], ['a', 'app', { down: true }]).edge('u', 'a');
    expect(S.simulate(d.doc).dropFrac.a).toBe(1);
  });
});

describe('retries and breakers', () => {
  const extDesign = (edge, extOver = {}) =>
    design({ users: 12000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['x', 'ext', { tech: 'Third-party API', ...extOver }]).edge('u', 'api').edge('api', 'x', edge);

  test('every attempt to an offline server fails, so each request costs retries + 1 calls', () => {
    const s = S.simulate(extDesign({ retries: 2 }, { down: true }).doc);
    expect(s.retryAmp.e2).toBe(3);
    expect(s.inflow.x).toBeCloseTo(s.rps * 3, 9);
    expect(s.errorRate).toBe(1);
  });

  test('a target that failed every request last second also gets retries + 1 attempts', () => {
    const s = S.simulate(extDesign({ retries: 3 }).doc, rt0({ fail: { x: 1 } }));
    expect(s.retryAmp.e2).toBe(4);
  });

  test('retries are clamped to 0..MAX_RETRIES and rounded', () => {
    const fail = rt0({ fail: { x: 0.5 } });
    const amp = (retries) => S.simulate(extDesign({ retries }).doc, fail).retryAmp.e2;
    expect(amp(10)).toBeCloseTo(1 + 0.5 + 0.25 + 0.125, 12);
    expect(amp(-2)).toBeUndefined();
    expect(amp(1.4)).toBeCloseTo(1.5, 12);
  });

  test('retries to an offline read-through cache are not amplified (it passes traffic on)', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['c', 'cache', { down: true }], ['db', 'db'])
      .edge('u', 'api').edge('api', 'c', { retries: 3 }).edge('c', 'db');
    const s = S.simulate(d.doc);
    expect(s.retryAmp).toEqual({});
    expect(s.inflow.db).toBeCloseTo(s.rps, 9);
  });

  test('an open breaker on a fan-out call fails every request fast', () => {
    const s = S.simulate(extDesign({ breaker: true, calls: 1 }).doc, rt0({ breaker: { e2: 5 } }));
    expect(s.breakerOpen.e2).toBe(true);
    expect(s.inflow.x).toBe(0);
    expect(s.errorRate).toBe(1);
    expect(s.fastFailRate).toBe(1);
    expect(s.p95).toBeLessThan(1000);
  });

  test('a closed breaker changes nothing', () => {
    const plain = S.simulate(extDesign({}).doc), closed = S.simulate(extDesign({ breaker: true }).doc, rt0({ breaker: { e2: 0 } }));
    expect(closed.inflow).toEqual(plain.inflow);
    expect(closed.breakerOpen).toEqual({});
  });
});

describe('latency tail', () => {
  test('a few percent of timeouts set the P99; more set the P95 too', () => {
    // ext capacity 3000 rps: just over the limit drops ~1%, far over drops a lot
    const mk = (users) => design({ users }, ['u', 'users'], ['api', 'app', { size: 4 }], ['x', 'ext', { tech: 'Third-party API' }]).edge('u', 'api').edge('api', 'x');
    const small = S.simulate(mk(50700).doc); // 3042 rps → ~1.4% dropped
    expect(small.errorRate).toBeGreaterThan(0.005);
    expect(small.errorRate).toBeLessThan(0.02);
    expect(small.p99).toBeCloseTo(1200 + Math.min(1, small.errorRate * 4) * 6000, 6);
    expect(small.p95).toBeLessThan(1200);
    const big = S.simulate(mk(100000).doc);
    expect(big.p95).toBeCloseTo(1200 + big.errorRate * 6000, 6);
    expect(big.p99).toBeGreaterThanOrEqual(big.p95);
  });
});

describe('cost', () => {
  test('sized kinds pay per machine × cost multiplier; databases pay per shard and replica', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['lb', 'lb'], ['a', 'app', { size: 1, replicas: 3 }], ['db', 'db', { size: 2, dbc: { shards: 2, replicas: 1 } }], ['c', 'cache', { size: 0 }])
      .edge('u', 'lb').edge('lb', 'a').edge('a', 'db').edge('a', 'c');
    const s = S.simulate(d.doc);
    expect(s.nodeCost).toEqual({ u: 0, lb: 25, a: 240 * 3, db: 600 * 1.4 * 2 * 2, c: 60 * 0.6 });
    expect(s.cost).toBeCloseTo(25 + 720 + 3360 + 36, 9);
  });
});

describe('bottleneck', () => {
  test('the busiest live node, ignoring users and offline nodes', () => {
    const d = design({ users: 30000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['db', 'db', { size: 0 }], ['x', 'ext', { down: true }])
      .edge('u', 'api').edge('api', 'db').edge('api', 'x', { mode: 'async', calls: 1 });
    const s = S.simulate(d.doc);
    const b = S.bottleneck(d.doc, s);
    expect(b.node.id).toBe('db');
    expect(b.load).toBe(s.load.db);
  });

  test('ties keep the first node; nodes without a load count as 0', () => {
    const doc = S.blankDoc({ nodes: [S.makeNode('a', 'app', 0, 0, 'a'), S.makeNode('b', 'app', 0, 0, 'b')] });
    expect(S.bottleneck(doc, { load: { a: 0.5, b: 0.5 } }).node.id).toBe('a');
    expect(S.bottleneck(doc, { load: { b: 0.1 } }).node.id).toBe('b');
    expect(S.bottleneck(doc, { load: {} })).toEqual({ node: doc.nodes[0], load: 0 });
  });

  test('null when there is nothing but users', () => {
    const d = design({}, ['u', 'users'], ['x', 'app', { down: true }]);
    expect(S.bottleneck(d.doc, S.simulate(d.doc))).toBeNull();
  });
});
