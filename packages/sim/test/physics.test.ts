import { test } from 'vitest';
import assert from 'node:assert/strict';
import { S, design, run } from './helpers';

test('Erlang C matches textbook values', () => {
  // M/M/1: P(wait) = ρ
  assert.ok(Math.abs(S.erlangC(1, 0.5) - 0.5) < 1e-9);
  // c = 2, a = 1 (ρ = 0.5): C = 1/3
  assert.ok(Math.abs(S.erlangC(2, 1) - 1 / 3) < 1e-9);
  // c = 10, a = 8: C ≈ 0.4092
  assert.ok(Math.abs(S.erlangC(10, 8) - 0.4092) < 1e-3);
  assert.equal(S.erlangC(4, 4), 1);
  assert.equal(S.erlangC(4, 0), 0);
});

test('queue wait: M/M/1 mean wait is ρ/(1-ρ) × S', () => {
  const q = S.queueTimes(1, 10, 0.8);
  assert.ok(Math.abs(q.meanWait - 40) < 1e-6, `${q.meanWait}`);
  assert.ok(q.p99Wait > q.p95Wait && q.p95Wait > q.meanWait);
});

test('a big worker pool barely queues at 85%; a small one queues a lot', () => {
  const big = S.queueTimes(100, 20, 0.85).meanWait, small = S.queueTimes(4, 20, 0.85).meanWait;
  assert.ok(big < 1, `big pool waits ${big}`);
  assert.ok(small > 10 * big, `small pool waits ${small}`);
});

test('latency rises smoothly, then sharply near saturation', () => {
  const d = design({ users: 1000 }, ['u', 'users'], ['api', 'app', { size: 0 }]).edge('u', 'api');
  const cap = S.capacityPerInstance(d.node('api'));
  const at = (rho) => { d.doc.users = (rho * cap) / S.RPS_PER_USER; return S.simulate(d.doc); };
  const l50 = at(0.5).nodeLatency.api, l90 = at(0.9).nodeLatency.api, l99 = at(0.99).nodeLatency.api;
  assert.ok(l50 < l90 && l90 < l99);
  assert.ok(l99 - l90 > l90 - l50, `${l50} ${l90} ${l99}`);
});

test('p99 is never below p95, p95 never below the mean', () => {
  const d = design({ users: 50000 }, ['u', 'users'], ['lb', 'lb'], ['api', 'app'], ['db', 'db']).edge('u', 'lb').edge('lb', 'api').edge('api', 'db');
  for (const u of [0, 1000, 50000, 120000, 500000]) {
    d.doc.users = u;
    const s = S.simulate(d.doc);
    assert.ok(s.p99 >= s.p95 && s.p95 >= s.meanLatency, `${u}: ${s.meanLatency} ${s.p95} ${s.p99}`);
  }
});

test('technology changes capacity: Go serves more than Python on the same machine', () => {
  const go = S.capacityPerInstance(S.makeNode('a', 'app', 0, 0, 'a', { tech: 'Go' }));
  const node = S.capacityPerInstance(S.makeNode('a', 'app', 0, 0, 'a', { tech: 'Node.js' }));
  const py = S.capacityPerInstance(S.makeNode('a', 'app', 0, 0, 'a', { tech: 'Python' }));
  assert.ok(go > node && node > py);
  assert.equal(S.capacityPerInstance(S.makeNode('a', 'app', 0, 0, 'a', { tech: 'Elixir' })), node, 'unknown tech = baseline');
});

test('a measured capacity replaces the estimate and scales with machine size', () => {
  const n = S.makeNode('a', 'app', 0, 0, 'a', { size: 2, measured: { rps: 3500, ms: 12 } });
  assert.equal(S.capacityPerInstance(n), 3500);
  assert.equal(S.capacityPerInstance(n, 3), 3500 * 4); // 16 → 64 vCPU
  assert.equal(S.serviceTime(n), 12);
});

test('fan-out: calls per request multiply traffic instead of splitting it', () => {
  const d = design({ users: 10000 }, ['u', 'users'], ['api', 'app', { size: 3 }], ['a', 'app', { size: 3 }], ['b', 'app', { size: 3 }], ['db', 'db', { size: 3 }])
    .edge('u', 'api').edge('api', 'a').edge('api', 'b');
  const split = S.simulate(d.doc);
  assert.ok(Math.abs(split.inflow.a - split.rps / 2) < 1e-6, 'default: split by weight');
  d.doc.edges[1].calls = 1;
  d.doc.edges[2].calls = 3;
  const fan = S.simulate(d.doc);
  assert.ok(Math.abs(fan.inflow.a - fan.rps) < 1e-6);
  assert.ok(Math.abs(fan.inflow.b - fan.rps * 3) < 1e-6);
  assert.ok(fan.meanLatency > split.meanLatency, 'three sequential calls take longer');
});

test('Postgres refuses connections past max_connections', () => {
  const d = design({ users: 30000 }, ['u', 'users'], ['lb', 'lb'], ['api', 'app', { replicas: 20, size: 0 }], ['db', 'db', { size: 4, tech: 'Postgres' }])
    .edge('u', 'lb').edge('lb', 'api').edge('api', 'db');
  const s = S.simulate(d.doc);
  assert.deepEqual(s.dbConns.db, { need: 200, limit: 100 });
  assert.ok(Math.abs(s.errorRate - 0.5) < 0.01, `half the requests get no connection: ${s.errorRate}`);
  d.set('db', { dbc: { maxConn: 1000 } }); // a pooler such as PgBouncer
  assert.equal(S.simulate(d.doc).errorRate, 0);
  d.set('db', { dbc: {}, tech: 'DynamoDB' });
  const dyn = S.simulate(d.doc);
  assert.equal(dyn.dbConns.db, undefined);
  assert.equal(dyn.errorRate, 0);
});

test('retries amplify load on a struggling server (retry storm)', () => {
  const mk = (retries) => design({ users: 80000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['ext', 'ext', { tech: 'Third-party API' }])
    .edge('u', 'api').edge('api', 'ext', { retries });
  const none = run(mk(0).doc, 5).sim, three = run(mk(3).doc, 5).sim;
  assert.ok(three.inflow.ext > none.inflow.ext * 1.2, `${none.inflow.ext} → ${three.inflow.ext}`);
  assert.ok(three.retryAmp.e2 > 1.2);
  // the server stays overloaded, so retries do not save the requests
  assert.ok(three.errorRate >= none.errorRate * 0.8);
});

test('retries hide a small blip: errors fall to f^(r+1)', () => {
  // 10% overload: one retry turns ~9% failures into ~1%
  const mk = (retries) => design({ users: 55000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['ext', 'ext', { tech: 'Third-party API' }])
    .edge('u', 'api').edge('api', 'ext', { retries });
  const base = S.simulate(mk(0).doc);
  assert.ok(base.errorRate > 0.05 && base.errorRate < 0.2, `${base.errorRate}`);
  const d = mk(1);
  const rt = { ...S.EMPTY_RUNTIME, fail: { ext: 0.01 } };
  const s = S.simulate(d.doc, rt);
  assert.ok(s.errorRate < base.errorRate, `${s.errorRate} vs ${base.errorRate}`);
});

test('a circuit breaker fails fast and lets the target recover', () => {
  const d = design({ users: 12000 }, ['u', 'users'], ['api', 'app', { size: 4 }], ['ext', 'ext', { down: true, tech: 'Third-party API' }])
    .edge('u', 'api').edge('api', 'ext', { breaker: true });
  const { sim, rt } = run(d.doc, 2);
  assert.ok(rt.breaker.e2 > 0, 'tripped');
  assert.equal(sim.breakerOpen.e2, true);
  assert.equal(sim.inflow.ext, 0, 'no calls while open');
  assert.ok(sim.fastFailRate > 0.99);
  assert.ok(sim.p95 < 1000, `fast failures do not wait for a timeout: ${sim.p95}`);
  d.set('ext', { down: false });
  const later = run(d.doc, S.BREAKER_OPEN_S + 2, rt).sim;
  assert.equal(later.errorRate, 0, 'closed again once the target is healthy');
});

test('fan-out errors count each user request once', () => {
  // API calls A and B for every request and each drops half of its calls, so a request
  // succeeds with 0.5 × 0.5: 75% errors, not 50% + 50% = 100%.
  const d = design({ users: 20000 }, ['u', 'users'], ['api', 'app', { size: 4 }],
    ['a', 'ext', { tech: 'Third-party API', measured: { rps: 600 } }], ['b', 'ext', { tech: 'Third-party API', measured: { rps: 600 } }])
    .edge('u', 'api').edge('api', 'a', { calls: 1 }).edge('api', 'b', { calls: 1 });
  const s = S.simulate(d.doc);
  assert.ok(Math.abs(s.dropFrac.a - 0.5) < 1e-9 && Math.abs(s.dropFrac.b - 0.5) < 1e-9);
  assert.ok(Math.abs(s.errorRate - 0.75) < 1e-6, `${s.errorRate}`);
});
