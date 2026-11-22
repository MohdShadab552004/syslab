import { test } from 'vitest';
import assert from 'node:assert/strict';
import { S, design, run } from './helpers';

const basic = (users = 12000) => design({ users }, ['u', 'users'], ['api', 'app'], ['db', 'db']).edge('u', 'api').edge('api', 'db');

test('zero users means zero traffic and zero errors', () => {
  const s = S.simulate(basic(0).doc);
  assert.equal(s.rps, 0);
  assert.equal(s.errorRate, 0);
  assert.equal(s.inflow.db, 0);
});

test('traffic is users × requests per user', () => {
  const s = S.simulate(basic(10000).doc);
  assert.equal(s.rps, 10000 * S.RPS_PER_USER);
  assert.equal(s.inflow.api, s.rps);
});

test('latency grows with load and stays finite', () => {
  const p = [1000, 20000, 60000, 90000].map((u) => S.simulate(basic(u).doc).p95);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1], `p95 should not drop as load rises: ${p}`);
  assert.ok(p.every(Number.isFinite));
});

test('overload drops requests and the tail goes to timeouts', () => {
  const s = S.simulate(basic(2_000_000).doc);
  assert.ok(s.errorRate > 0.5, `errorRate ${s.errorRate}`);
  assert.ok(s.p95 > 1000);
});

test('an offline node fails everything behind it', () => {
  const d = basic(12000).set('db', { down: true });
  assert.equal(S.simulate(d.doc).errorRate, 1);
});

test('cache-aside: db gets misses + writes, and everything when the cache is offline', () => {
  const d = design({ users: 60000, read: 90 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache'], ['db', 'db', { size: 4 }])
    .edge('u', 'api').edge('api', 'c').edge('api', 'db');
  const on = S.simulate(d.doc);
  const reads = on.rps * 0.9;
  assert.ok(Math.abs(on.inflow.c - reads) < 1);
  assert.ok(Math.abs(on.inflow.db - (reads * (1 - S.CACHE_HIT) + on.rps * 0.1)) < 1);
  d.set('c', { down: true });
  const off = S.simulate(d.doc);
  assert.ok(Math.abs(off.inflow.db - on.rps) < 1);
});

test('read-through cache: an offline cache is bypassed', () => {
  const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['c', 'cache'], ['db', 'db']).edge('u', 'api').edge('api', 'c').edge('c', 'db');
  const on = S.simulate(d.doc);
  d.set('c', { down: true });
  const off = S.simulate(d.doc);
  assert.ok(off.inflow.db > on.inflow.db * 3);
  assert.equal(off.errorRate, 0);
});

test('cache keys expire over one TTL while the db is down, then everything fails', () => {
  const d = design({ users: 60000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['c', 'cache', { cachec: { ttl: 30 } }], ['db', 'db', { down: true }])
    .edge('u', 'api').edge('api', 'c').edge('api', 'db');
  const t0 = S.simulate(d.doc);
  assert.ok(t0.errorRate > 0.1 && t0.errorRate < 0.3, `start ${t0.errorRate}`);
  const half = run(d.doc, 15).sim.errorRate;
  assert.ok(half > t0.errorRate && half < 1, `half ${half}`);
  assert.equal(run(d.doc, 30).sim.errorRate, 1);
});

test('a cache back from offline starts cold and warms up', () => {
  const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app'], ['c', 'cache', { down: true }], ['db', 'db']).edge('u', 'api').edge('api', 'c').edge('api', 'db');
  const { rt } = run(d.doc, 2);
  d.set('c', { down: false });
  const cold = S.simulate(d.doc, rt);
  assert.equal(cold.cacheHit.c, 0);
  const warm = run(d.doc, 30, rt).sim;
  assert.ok(Math.abs(warm.cacheHit.c - S.CACHE_HIT) < 0.01);
  assert.ok(warm.inflow.db < cold.inflow.db / 3);
});

test('round robin splits evenly; weighted follows weights', () => {
  const d = design({ users: 12000 }, ['u', 'users'], ['lb', 'lb'], ['a', 'app'], ['b', 'app']).edge('u', 'lb').edge('lb', 'a').edge('lb', 'b', { weight: 3 });
  const rr = S.simulate(d.doc);
  assert.ok(Math.abs(rr.inflow.a - rr.inflow.b) < 1);
  d.set('lb', { lbc: { algo: 'wrr' } });
  const w = S.simulate(d.doc);
  assert.ok(Math.abs(w.inflow.b / w.inflow.a - 3) < 0.01);
});

test('least connections steers traffic away from a server that is filling up', () => {
  // 3.6k rps: an even split would push the small server (1.2k rps) far past its limit
  const d = design({ users: 60000 }, ['u', 'users'], ['lb', 'lb', { lbc: { algo: 'lc' } }], ['a', 'app', { size: 1 }], ['b', 'app', { size: 3 }])
    .edge('u', 'lb').edge('lb', 'a').edge('lb', 'b');
  const s = S.simulate(d.doc);
  assert.ok(s.inflow.b > s.inflow.a * 1.5, `${s.inflow.a} vs ${s.inflow.b}`);
  assert.equal(s.errorRate, 0);
});

test('horizontal autoscaling adds replicas under load', () => {
  const d = design({ users: 80000 }, ['u', 'users'], ['lb', 'lb'], ['a', 'app', { autoscale: S.autoH(2, 10) }]).edge('u', 'lb').edge('lb', 'a');
  const { sim } = run(d.doc, 40);
  assert.ok(sim.reps.a > 2, `reps ${sim.reps.a}`);
});

test('a queue absorbs a slow consumer as backlog instead of errors', () => {
  const d = design({ users: 60000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['q', 'queue'], ['w', 'worker', { size: 0 }])
    .edge('u', 'api').edge('api', 'q', { mode: 'async' }).edge('q', 'w', { mode: 'async' });
  const { sim } = run(d.doc, 5);
  assert.ok(sim.queue.q.depth > 0);
  assert.equal(sim.errorRate, 0);
});

test('read replicas raise read capacity', () => {
  const d = design({ users: 100000, read: 95 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['db', 'db', { size: 2 }]).edge('u', 'api').edge('api', 'db');
  const one = S.simulate(d.doc);
  d.set('db', { dbc: { replicas: 3 } });
  const four = S.simulate(d.doc);
  assert.ok(four.load.db < one.load.db / 2);
});

test('cost adds up node costs', () => {
  const s = S.simulate(basic().doc);
  const sum = Object.values(s.nodeCost).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - s.cost) < 1e-6);
});
