import { describe, test, expect } from 'vitest';
import type { DesignDoc, DesignEdge, DesignNode, NodeKind } from '@syslab/types';
import { autoH, autoV, makeEdge, makeNode } from '@syslab/sim';
import { layout, type Placed } from '../src/layout';
import { buildDesign } from '../src/build';
import { c, overlaps, spec, type Rect } from './helpers';

const rect = (p: Placed): Rect => ({ l: p.x - p.left, t: p.y - p.top, r: p.x + p.right, b: p.y + p.bottom });

function expectNoOverlap(placed: Map<string, Placed>) {
  const all = [...placed.entries()];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, pa] = all[i], [b, pb] = all[j];
      expect(overlaps(rect(pa), rect(pb)), `${a} overlaps ${b}`).toBe(false);
    }
  }
}

/** Re-run the layout on a built doc to get the extents back. */
function relayout(doc: DesignDoc, groups: string[][] = []) {
  return layout(doc.nodes, doc.edges, groups);
}

let seq = 0;
const N = (id: string, kind: NodeKind, over: Partial<DesignNode> = {}) => makeNode(id, kind, 0, 0, id, over);
const E = (from: string, to: string): DesignEdge => makeEdge(`x${++seq}`, from, to);

describe('layout: columns', () => {
  test('columns follow hops from the users, left to right', () => {
    const nodes = [N('db', 'db'), N('u', 'users'), N('lb', 'lb'), N('api', 'app')];
    const { nodes: p } = layout(nodes, [E('u', 'lb'), E('lb', 'api'), E('api', 'db')], []);
    const xs = ['u', 'lb', 'api', 'db'].map((id) => p.get(id)!.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(p.get('u')!.x).toBeGreaterThanOrEqual(150);
    expect(p.get('u')!.y).toBeGreaterThanOrEqual(140);
    // positions snap to a 10px grid
    for (const v of p.values()) { expect(v.x % 10).toBe(0); expect(v.y % 10).toBe(0); }
  });

  test('a cycle does not break layering (the edge closing it is ignored)', () => {
    const nodes = [N('u', 'users'), N('a', 'app'), N('b', 'app'), N('c', 'app')];
    const { nodes: p } = layout(nodes, [E('u', 'a'), E('a', 'b'), E('b', 'c'), E('c', 'a'), E('u', 'c')], []);
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('b')!.x).toBeLessThan(p.get('c')!.x);
    expectNoOverlap(p);
  });

  test('without users, layering starts from nodes nobody calls; a pure cycle still gets placed', () => {
    const nodes = [N('a', 'app'), N('b', 'app'), N('x', 'worker'), N('y', 'worker')];
    const { nodes: p } = layout(nodes, [E('a', 'b'), E('x', 'y'), E('y', 'x')], []);
    expect(p.size).toBe(4);
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('x')!.x).not.toBe(p.get('y')!.x);
  });

  test('edges to unknown nodes are tolerated', () => {
    const { nodes: p } = layout([N('u', 'users'), N('a', 'app')], [E('u', 'a'), E('ghost', 'phantom')], []);
    expect(p.size).toBe(2);
  });

  test('inside a column nodes follow the order of their callers', () => {
    // p sits above q; their children are listed in the opposite order but still follow them
    const nodes = [N('u', 'users'), N('p', 'app'), N('q', 'app'), N('qc', 'db'), N('pc', 'db')];
    const { nodes: pl } = layout(nodes, [E('u', 'p'), E('u', 'q'), E('q', 'qc'), E('p', 'pc')], []);
    expect(pl.get('p')!.y).toBeLessThan(pl.get('q')!.y);
    expect(pl.get('pc')!.y).toBeLessThan(pl.get('qc')!.y);
  });

  test('an empty design has a free spot', () => {
    const out = layout([], [], []);
    expect(out.nodes.size).toBe(0);
    expect(out.freeSpot(0)).toEqual({ x: 150, y: 140 });
  });
});

describe('layout: sub-columns', () => {
  const fan = (k: number) => {
    const nodes = [N('u', 'users'), N('gw', 'gateway'), ...Array.from({ length: k }, (_, i) => N(`s${i}`, 'app'))];
    const edges = [E('u', 'gw'), ...Array.from({ length: k }, (_, i) => E('gw', `s${i}`))];
    return layout(nodes, edges, []).nodes;
  };
  const xsOf = (p: Map<string, Placed>, k: number) => new Set(Array.from({ length: k }, (_, i) => p.get(`s${i}`)!.x));

  test('four nodes in a layer stay in one column', () => {
    expect(xsOf(fan(4), 4).size).toBe(1);
  });

  test('more than four wrap into side-by-side sub-columns of at most four', () => {
    const p5 = fan(5);
    expect(xsOf(p5, 5).size).toBe(2);
    expectNoOverlap(p5);
    const p9 = fan(9);
    const xs = [...xsOf(p9, 9)].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    for (const x of xs) expect([...p9.entries()].filter(([id, v]) => id.startsWith('s') && v.x === x).length).toBeLessThanOrEqual(4);
    expectNoOverlap(p9);
  });

  test('a sub-columned layer pushes the next column right', () => {
    const nodes = [N('u', 'users'), N('gw', 'gateway'), ...Array.from({ length: 8 }, (_, i) => N(`s${i}`, 'app')), N('db', 'db')];
    const edges = [E('u', 'gw'), ...Array.from({ length: 8 }, (_, i) => E('gw', `s${i}`)), E('s0', 'db')];
    const p = layout(nodes, edges, []).nodes;
    const maxS = Math.max(...Array.from({ length: 8 }, (_, i) => p.get(`s${i}`)!.x + p.get(`s${i}`)!.right));
    expect(p.get('db')!.x - p.get('db')!.left).toBeGreaterThan(maxS);
  });
});

describe('layout: room for replicas, shards and replicas of a db', () => {
  test('extents grow with replicas and db clusters', () => {
    const nodes = [
      N('u', 'users'),
      N('one', 'app'),
      N('rep3', 'app', { replicas: 3 }),
      N('rep12', 'app', { replicas: 12 }),
      N('autoh', 'worker', { autoscale: autoH(2, 10) }),
      N('autoh1', 'worker', { autoscale: autoH(1, 1) }),
      N('autov', 'app', { autoscale: autoV(0, 4), replicas: 2 }),
      N('cacheRep', 'cache', { replicas: 5 }),
      N('db', 'db'),
      N('shards', 'db', { dbc: { shards: 3 } }),
      N('reps', 'db', { dbc: { replicas: 2 } }),
      N('both', 'db', { dbc: { shards: 6, replicas: 5 } }),
    ];
    const edges = nodes.slice(1).map((n) => E('u', n.id));
    const { nodes: p } = layout(nodes, edges, []);
    const w = (id: string) => p.get(id)!.left + p.get(id)!.right;
    const h = (id: string) => p.get(id)!.top + p.get(id)!.bottom;
    expect(w('rep3')).toBeGreaterThan(w('one'));
    expect(h('rep3')).toBeGreaterThan(h('one'));
    expect(w('rep12')).toBeGreaterThan(w('rep3') + 100); // 12 replicas show as two columns of four
    expect(w('autoh')).toBeGreaterThan(w('one'));
    expect(w('autoh1')).toBe(p.get('autoh1')!.w + 60); // max 1: no fan-out
    expect(w('autov')).toBeGreaterThan(w('one')); // vertical autoscale: replicas decide
    expect(w('cacheRep')).toBe(p.get('cacheRep')!.w + 60); // caches do not fan out
    expect(w('shards')).toBeGreaterThan(w('db'));
    expect(h('shards')).toBe(h('db'));
    expect(h('reps')).toBeGreaterThan(h('db'));
    expect(w('both')).toBeGreaterThan(w('shards'));
    expect(p.get('one')).toMatchObject({ w: 112, h: 112, left: 76, right: 96, top: 108, bottom: 102 });
    expectNoOverlap(p);
  });
});

describe('layout: groups and bands', () => {
  test('a built design: no overlaps and every group box contains its members', () => {
    const { doc } = buildDesign(spec({
      components: [
        c('Users', 'users'), c('CDN', 'cdn'), c('LB', 'lb'), c('GW', 'gateway'),
        ...Array.from({ length: 6 }, (_, i) => c(`Svc ${i}`, 'app', { replicas: (i % 3) + 1 })),
        c('Redis', 'cache'), c('DB', 'db', { database: { shards: 2, readReplicas: 2 } }), c('Q', 'queue'), c('W', 'worker', { autoscale: { max: 8 } }),
        c('S3', 'store'), c('Stripe', 'ext'),
      ],
      connections: [
        { from: 'Users', to: 'CDN' }, { from: 'Users', to: 'LB' }, { from: 'LB', to: 'GW' },
        ...Array.from({ length: 6 }, (_, i) => ({ from: 'GW', to: `Svc ${i}` })),
        { from: 'Svc 0', to: 'Redis' }, { from: 'Redis', to: 'DB' }, { from: 'Svc 1', to: 'Q', async: true }, { from: 'Q', to: 'W', async: true },
        { from: 'W', to: 'S3' }, { from: 'Svc 2', to: 'Stripe' }, { from: 'CDN', to: 'S3' },
      ],
      groups: [
        { name: 'Services', members: Array.from({ length: 6 }, (_, i) => `Svc ${i}`) },
        { name: 'Data', members: ['Redis', 'DB'] },
        { name: 'Async', members: ['Q', 'W'] },
      ],
    }));
    const ids = (labels: string[]) => labels.map((l) => doc.nodes.find((n) => n.label === l)!.id);
    const groupIds = [ids(Array.from({ length: 6 }, (_, i) => `Svc ${i}`)), ids(['Redis', 'DB']), ids(['Q', 'W'])];
    const out = relayout(doc, groupIds);
    expectNoOverlap(out.nodes);
    // the built doc uses the same positions
    for (const n of doc.nodes) expect([n.x, n.y]).toEqual([out.nodes.get(n.id)!.x, out.nodes.get(n.id)!.y]);

    doc.groups.forEach((g, i) => {
      for (const id of groupIds[i]) {
        const r = rect(out.nodes.get(id)!);
        expect(r.l).toBeGreaterThanOrEqual(g.x);
        expect(r.t).toBeGreaterThanOrEqual(g.y);
        expect(r.r).toBeLessThanOrEqual(g.x + g.w);
        expect(r.b).toBeLessThanOrEqual(g.y + g.h);
      }
      // and no other node's anchor sits inside the box
      for (const n of doc.nodes) {
        if (groupIds[i].includes(n.id)) continue;
        const inside = n.x >= g.x && n.x <= g.x + g.w && n.y >= g.y && n.y <= g.y + g.h;
        expect(inside, `${n.label} inside ${g.label}`).toBe(false);
      }
    });
  });

  test('bands in different columns pack side by side; overlapping columns stack', () => {
    const nodes = [N('u', 'users'), N('a1', 'app'), N('a2', 'app'), N('b1', 'app'), N('b2', 'app')];
    const edges = [E('u', 'a1'), E('a1', 'a2'), E('a2', 'b1'), E('b1', 'b2')];
    const side = layout(nodes, edges, [['a1', 'a2'], ['b1', 'b2']]);
    const A = side.groupBox(['a1', 'a2']), B = side.groupBox(['b1', 'b2']);
    expect(A.y).toBe(B.y);
    expect(A.x + A.w).toBeLessThan(B.x);

    // same nodes, but group B also owns a node in A's columns → B must drop below A
    const stacked = layout(nodes, edges, [['a2', 'b1'], ['a1', 'b2']]);
    const A2 = stacked.groupBox(['a2', 'b1']), B2 = stacked.groupBox(['a1', 'b2']);
    expect(B2.y).toBeGreaterThanOrEqual(A2.y + A2.h);
    expectNoOverlap(stacked.nodes);
  });

  test('ungrouped nodes come first, groups below them in the same columns', () => {
    const nodes = [N('u', 'users'), N('free', 'app'), N('g', 'app')];
    const out = layout(nodes, [E('u', 'free'), E('u', 'g')], [['g']]);
    const box = out.groupBox(['g']);
    expect(out.nodes.get('free')!.y + out.nodes.get('free')!.bottom).toBeLessThan(box.y);
  });

  test('a node in two groups goes to the smaller (innermost) one', () => {
    const nodes = [N('u', 'users'), N('a', 'app'), N('b', 'app'), N('c', 'app')];
    const edges = [E('u', 'a'), E('u', 'b'), E('u', 'c')];
    // outer = [a, b, c], inner = [b]; also a group identical in size to outer that owns nothing
    const out = layout(nodes, edges, [['a', 'b', 'c'], ['b'], ['a', 'b', 'c']]);
    const inner = out.groupBox(['b']);
    const outer = out.groupBox(['a', 'b', 'c']);
    // b sits in its own band below the outer band's a and c
    expect(out.nodes.get('b')!.y).toBeGreaterThan(out.nodes.get('a')!.y);
    expect(out.nodes.get('b')!.y).toBeGreaterThan(out.nodes.get('c')!.y);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(outer.y + outer.h).toBeGreaterThanOrEqual(inner.y + inner.h);
    expectNoOverlap(out.nodes);
  });

  test('groupBox of unknown ids falls back to a default box; freeSpot is below everything', () => {
    const out = layout([N('u', 'users'), N('a', 'app')], [E('u', 'a')], []);
    expect(out.groupBox(['ghost'])).toEqual({ x: 150, y: 140, w: 320, h: 220 });
    expect(out.groupBox(['a', 'ghost'])).toEqual(out.groupBox(['a']));
    const spot = out.freeSpot(2);
    expect(spot.x).toBe(150 + 440);
    for (const p of out.nodes.values()) expect(spot.y).toBeGreaterThan(p.y + p.bottom);
  });
});
