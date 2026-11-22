import { describe, expect, test } from 'vitest';
import { S, design } from './helpers';

const be = (key, over = {}) => ({ key, nodeId: key, edgeId: `e-${key}`, replica: 0, cap: 1000, lat: 10, workers: 10, weight: 1, ...over });
const flat = (b) => b.lat; // latency that does not grow with load
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

describe('balance', () => {
  test('no backends, no shares', () => {
    for (const a of ['rr', 'wrr', 'lc', 'hash']) expect(S.balance(a, [], 100, 10, flat)).toEqual([]);
  });

  test('round robin: equal shares', () => {
    expect(S.balance('rr', [be('a'), be('b'), be('c', { weight: 9 }), be('d')], 100, 10, flat)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  test('weighted round robin follows weights; zero weights fall back to equal', () => {
    expect(S.balance('wrr', [be('a', { weight: 1 }), be('b', { weight: 3 })], 100, 10, flat)).toEqual([0.25, 0.75]);
    expect(S.balance('wrr', [be('a', { weight: 0 }), be('b', { weight: 0 })], 100, 10, flat)).toEqual([0.5, 0.5]);
  });

  test('least connections with no traffic splits evenly', () => {
    expect(S.balance('lc', [be('a'), be('b', { lat: 99 })], 0, 10, flat)).toEqual([0.5, 0.5]);
  });

  test('least connections at steady state: rps × latency is equal, so shares go as 1/latency', () => {
    const s = S.balance('lc', [be('a', { lat: 1 }), be('b', { lat: 3 })], 100, 10, flat);
    expect(s[0]).toBeCloseTo(0.75, 6);
    expect(s[1]).toBeCloseTo(0.25, 6);
    const same = S.balance('lc', [be('a'), be('b'), be('c')], 300, 10, flat);
    for (const x of same) expect(x).toBeCloseTo(1 / 3, 6);
  });

  test('least connections backs off a server whose latency climbs with load', () => {
    // b gets slow fast (queueing); a stays flat
    const lat = (b, rps) => (b.key === 'b' ? 1 + rps / 10 : 2);
    const s = S.balance('lc', [be('a'), be('b')], 100, 10, lat);
    expect(sum(s)).toBeCloseTo(1, 9);
    // equal connections: 2·x = y·(1 + y/10) with x + y = 100
    const y = s[1] * 100, x = s[0] * 100;
    expect(2 * x).toBeCloseTo(y * (1 + y / 10), 3);
    expect(s[0]).toBeGreaterThan(s[1]);
  });

  test('least connections: a backend that can take everything below the target takes all it is offered', () => {
    // a has almost no latency, so its connection count at the full rate is below any K the solver tries
    const s = S.balance('lc', [be('a', { lat: 1e-9 }), be('b', { lat: 1000 })], 100, 10, flat);
    expect(s[0]).toBeGreaterThan(0.999);
  });

  test('least connections falls back to an even split when no backend can take any traffic', () => {
    // degenerate latency (NaN) with the smallest representable rate: the solver ends at 0 rps everywhere
    const s = S.balance('lc', [be('a'), be('b')], Number.MIN_VALUE, 10, () => NaN);
    expect(s).toEqual([0.5, 0.5]);
  });

  test('IP hash: shares sum to 1, are deterministic and at least one vnode is used', () => {
    const bs = [be('a:0'), be('b:0'), be('c:0')];
    const s = S.balance('hash', bs, 100, 10, flat);
    expect(sum(s)).toBeCloseTo(1, 12);
    expect(S.balance('hash', bs, 999, 10, flat)).toEqual(s); // independent of traffic
    expect(S.balance('hash', bs, 100, 0, flat)).toEqual(S.balance('hash', bs, 100, 1, flat));
    expect(S.balance('hash', bs, 100, 1.4, flat)).toEqual(S.balance('hash', bs, 100, 1, flat));
  });

  test('IP hash: more virtual nodes make the split smoother', () => {
    const bs = ['a', 'b', 'c', 'd'].map((k) => be(`${k}:0`));
    const spread = (v) => { const s = S.balance('hash', bs, 100, v, flat); return Math.max(...s) - Math.min(...s); };
    expect(spread(200)).toBeLessThan(spread(1));
    expect(spread(200)).toBeLessThan(0.1);
  });

  test('IP hash is consistent: removing a server only moves its own users', () => {
    const bs = ['a', 'b', 'c', 'd'].map((k) => be(`${k}:0`));
    const before = S.balance('hash', bs, 100, 10, flat);
    const after = S.balance('hash', bs.slice(0, 3), 100, 10, flat);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeGreaterThanOrEqual(before[i] - 1e-12);
    expect(sum(after)).toBeCloseTo(1, 12);
  });

  test('LB_ALGOS lists every algorithm', () => {
    expect(S.LB_ALGOS.map((a) => a.key)).toEqual(['rr', 'wrr', 'lc', 'hash']);
    for (const a of S.LB_ALGOS) expect(a.hint.length).toBeGreaterThan(20);
  });
});

describe('load balancer in the simulation', () => {
  const lbDesign = (algo, over = {}) =>
    design({ users: 30000 }, ['u', 'users'], ['lb', 'lb', { lbc: { algo, vnodes: 25 } }], ['a', 'app', { replicas: 2, ...over }], ['b', 'app'])
      .edge('u', 'lb').edge('lb', 'a').edge('lb', 'b');

  test('IP hash splits by the ring over every replica', () => {
    const d = lbDesign('hash');
    const s = S.simulate(d.doc);
    const keys = ['a:0', 'a:1', 'b:0'];
    const want = S.balance('hash', keys.map((k) => be(k)), 1, 25, flat);
    expect(s.lbBackends.lb.map((b) => `${b.nodeId}:${b.replica}`)).toEqual(keys);
    s.lbBackends.lb.forEach((b, i) => {
      expect(b.share).toBeCloseTo(want[i], 12);
      expect(b.rps).toBeCloseTo(s.rps * want[i], 9);
      expect(b.down).toBe(false);
    });
    expect(s.inflow.a).toBeCloseTo(s.rps * (want[0] + want[1]), 9);
    expect(s.edgeRepRps.e2[1]).toBeCloseTo(s.rps * want[1], 9);
  });

  test('the health check skips an offline server', () => {
    const d = lbDesign('rr').set('a', { down: true });
    const s = S.simulate(d.doc);
    expect(s.lbBackends.lb).toEqual([
      { nodeId: 'a', edgeId: 'e2', replica: 0, share: 0, rps: 0, down: true },
      { nodeId: 'a', edgeId: 'e2', replica: 1, share: 0, rps: 0, down: true },
      { nodeId: 'b', edgeId: 'e3', replica: 0, share: 1, rps: s.rps, down: false },
    ]);
    expect(s.inflow.a).toBe(0);
    expect(s.inflow.b).toBe(s.rps);
    expect(s.errorRate).toBe(0);
  });

  test('backends are listed in edge order even when the first edge is down', () => {
    const d = lbDesign('rr').set('b', { down: true });
    const s = S.simulate(d.doc);
    expect(s.lbBackends.lb.map((b) => [b.edgeId, b.replica, b.down])).toEqual([['e2', 0, false], ['e2', 1, false], ['e3', 0, true]]);
  });

  test('every server offline: nothing reaches them and every request fails', () => {
    const d = lbDesign('lc').set('a', { down: true }).set('b', { down: true });
    const s = S.simulate(d.doc);
    expect(s.lbBackends.lb.every((b) => b.down && b.rps === 0)).toBe(true);
    expect(s.inflow.a + s.inflow.b).toBe(0);
    expect(s.dropFrac.lb).toBe(1);
    expect(s.errorRate).toBe(1);
  });

  test('weight 0 on a connection counts as 1 for weighted round robin', () => {
    const d = design({ users: 12000 }, ['u', 'users'], ['lb', 'lb', { lbc: { algo: 'wrr' } }], ['a', 'app'], ['b', 'app'])
      .edge('u', 'lb').edge('lb', 'a', { weight: 0 }).edge('lb', 'b', { weight: 1 });
    const s = S.simulate(d.doc);
    expect(s.inflow.a).toBeCloseTo(s.inflow.b, 9);
  });

  test('least connections with a backend that has no capacity limit uses its base latency', () => {
    // an LB pointed at a users node: infinite capacity and zero service time (treated as 1 ms)
    const d = design({ users: 12000 }, ['u', 'users'], ['lb', 'lb', { lbc: { algo: 'lc' } }], ['a', 'app'], ['x', 'users'])
      .edge('u', 'lb').edge('lb', 'a').edge('lb', 'x');
    const s = S.simulate(d.doc);
    const [a, x] = s.lbBackends.lb;
    expect(a.share + x.share).toBeCloseTo(1, 9);
    expect(x.share).toBeGreaterThan(a.share * 10);
  });
});
