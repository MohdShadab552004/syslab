import { describe, expect, test } from 'vitest';
import { S, design } from './helpers';

const node = (kind, over = {}) => S.makeNode('n', kind, 100, 200, 'n', over);
const fakeSim = (over = {}) => ({ reps: {}, needsLB: {}, sizeIdx: {}, ...over });

describe('isFanned', () => {
  test('an autoscalable kind behind a load balancer with several replicas is drawn as separate servers', () => {
    const d = design({}, ['u', 'users'], ['lb', 'lb'], ['a', 'app', { replicas: 3 }]).edge('u', 'lb').edge('lb', 'a');
    const sim = S.simulate(d.doc);
    expect(sim.reps.a).toBe(3);
    expect(S.isFanned(d.node('a'), sim)).toBe(true);
  });

  test('replicas without a load balancer are not fanned (the node needs one)', () => {
    const d = design({}, ['u', 'users'], ['a', 'app', { replicas: 3 }]).edge('u', 'a');
    const sim = S.simulate(d.doc);
    expect(sim.needsLB.a).toBe(true);
    expect(S.isFanned(d.node('a'), sim)).toBe(false);
  });

  test('a single replica, a missing replica count or a kind that cannot autoscale is not fanned', () => {
    expect(S.isFanned(node('app'), fakeSim({ reps: { n: 1 } }))).toBe(false);
    expect(S.isFanned(node('app'), fakeSim())).toBe(false);
    expect(S.isFanned(node('db'), fakeSim({ reps: { n: 4 } }))).toBe(false);
    expect(S.isFanned(node('worker'), fakeSim({ reps: { n: 2 } }))).toBe(true);
  });
});

describe('isDbCluster', () => {
  test('only databases with shards or replicas are clusters', () => {
    expect(S.isDbCluster(node('app'))).toBe(false);
    expect(S.isDbCluster(node('db'))).toBe(false);
    expect(S.isDbCluster(node('db', { dbc: { shards: 2 } }))).toBe(true);
    expect(S.isDbCluster(node('db', { dbc: { replicas: 1 } }))).toBe(true);
  });
});

describe('nodeScale', () => {
  test('sized kinds scale with the (possibly autoscaled) size; others are 1', () => {
    expect(S.nodeScale(node('app', { size: 2 }), fakeSim())).toBe(S.SIZE_SCALE[2]);
    expect(S.nodeScale(node('app', { size: 2 }), fakeSim({ sizeIdx: { n: 4 } }))).toBe(S.SIZE_SCALE[4]);
    expect(S.nodeScale(node('app', { size: 0 }), fakeSim({ sizeIdx: { n: 0 } }))).toBe(0.8);
    expect(S.nodeScale(node('lb'), fakeSim({ sizeIdx: { n: 4 } }))).toBe(1);
  });

  test('an out-of-range size falls back to 1', () => {
    expect(S.nodeScale(node('db', { size: 9 }), fakeSim())).toBe(1);
  });
});

describe('dbLayout', () => {
  test('primaries in a row, replicas centred under each primary', () => {
    const L = S.dbLayout(node('db', { dbc: { shards: 2, replicas: 2 } }));
    // gap = max(150, 2*60 + 50) = 170
    expect(L.primaries).toEqual([{ x: 100, y: 200 }, { x: 270, y: 200 }]);
    expect(L.replicas).toEqual([
      [{ x: 70, y: 350 }, { x: 130, y: 350 }],
      [{ x: 240, y: 350 }, { x: 300, y: 350 }],
    ]);
    expect(L.shown).toEqual({ shards: 2, replicas: 2 });
  });

  test('caps what is drawn and keeps a minimum gap', () => {
    const big = S.dbLayout(node('db', { dbc: { shards: 9, replicas: 7 } }));
    expect(big.shown).toEqual({ shards: S.MAX_VISIBLE_SHARDS, replicas: S.MAX_VISIBLE_DB_REPLICAS });
    expect(big.primaries.map((p) => p.x)).toEqual([100, 330, 560, 790]); // gap = 3*60 + 50 = 230
    const single = S.dbLayout(node('db'));
    expect(single.primaries).toEqual([{ x: 100, y: 200 }]);
    expect(single.replicas).toEqual([[]]);
    expect(S.dbLayout(node('db', { dbc: { shards: 2 } })).primaries[1].x).toBe(250); // minimum gap 150
  });
});

describe('instancePositions', () => {
  test('a db cluster is drawn at its primaries', () => {
    const n = node('db', { dbc: { shards: 3 } });
    expect(S.instancePositions(n, fakeSim())).toEqual(S.dbLayout(n).primaries);
  });

  test('a single server is drawn at the node position', () => {
    expect(S.instancePositions(node('app'), fakeSim())).toEqual([{ x: 100, y: 200 }]);
  });

  test('fanned servers form a diagonal centred on the node', () => {
    const pos = S.instancePositions(node('app'), fakeSim({ reps: { n: 3 } }));
    // rows = 3, y0 = 200 - 2*55 = 90
    expect(pos).toEqual([{ x: 100, y: 90 }, { x: 162, y: 200 }, { x: 224, y: 310 }]);
  });

  test('more than four wrap into a second column; at most eight are drawn', () => {
    const pos = S.instancePositions(node('app'), fakeSim({ reps: { n: 20 } }));
    expect(pos).toHaveLength(S.MAX_VISIBLE_REPLICAS);
    // rows = 4, y0 = 200 - 3*55 = 35
    expect(pos[0]).toEqual({ x: 100, y: 35 });
    expect(pos[3]).toEqual({ x: 286, y: 365 });
    expect(pos[4]).toEqual({ x: 265, y: 35 });
    expect(pos[7]).toEqual({ x: 451, y: 365 });
  });
});

describe('segment', () => {
  test('length and angle in degrees', () => {
    const s = S.segment({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.len).toBe(5);
    expect(s.ang).toBeCloseTo(53.1301, 3);
    expect(S.segment({ x: 10, y: 0 }, { x: 0, y: 0 }).ang).toBe(180);
  });

  test('a zero-length segment still has length 1', () => {
    expect(S.segment({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, len: 1, ang: 0 });
  });
});

describe('crowd', () => {
  test('nobody online is an empty platform', () => {
    expect(S.crowd(0)).toEqual([]);
    expect(S.crowd(0.5)).toEqual([]);
  });

  test('at least 3 and at most 15 people, more as traffic grows', () => {
    expect(S.crowd(1)).toHaveLength(3);
    expect(S.crowd(1e4)).toHaveLength(6); // round(4*3 - 6)
    expect(S.crowd(1e6)).toHaveLength(12);
    expect(S.crowd(1e12)).toHaveLength(15);
  });

  test('people are sorted back to front and use the palette', () => {
    const c = S.crowd(1e9);
    for (let i = 1; i < c.length; i++) expect(c[i].y).toBeGreaterThanOrEqual(c[i - 1].y);
    for (const p of c) expect(p.c).toMatch(/^#[0-9a-f]{6}$/);
    // the first person placed is slot 7 (r = 0, c = 0): (90, 60) shifted by (-6, -26)
    expect(S.crowd(1)).toContainEqual({ x: 84, y: 34, c: '#f7c99f' }); // cols[(7*7 + 0) % 6]
  });
});
