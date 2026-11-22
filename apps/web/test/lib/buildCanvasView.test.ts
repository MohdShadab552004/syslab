import { describe, expect, it } from 'vitest';
import type { DesignDoc, DesignNode } from '@syslab/types';
import {
  DOWN_COLORS, GROUP_COLORS, HOT_COLORS, KINDS, REPLICA_COLORS, autoH, autoV, blankDoc, makeEdge, makeNode, simulate,
  type Runtime, type SimResult,
} from '@syslab/sim';
import { buildCanvasView, type CanvasUi } from '@/lib/canvas/buildCanvasView';
import { GROUP_CARD } from '@/lib/canvas/groups';

const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};

function build(doc: DesignDoc, ui: Partial<CanvasUi> = {}, mut?: (s: SimResult) => void, rt?: Runtime) {
  const sim = simulate(doc, rt);
  mut?.(sim);
  return buildCanvasView(doc, sim, { ...UI, ...ui });
}
const nodeOf = (v: ReturnType<typeof build>, id: string) => v.nodes.find((n) => n.id === id)!;
const edgeOf = (v: ReturnType<typeof build>, id: string) => v.edges.find((e) => e.id === id)!;
const N = makeNode, E = makeEdge;

/* ------------------------------------------------------------------ */

describe('basic chain', () => {
  const doc = blankDoc({
    nodes: [N('u', 'users', 0, 300, 'Users'), N('app', 'app', 400, 300, 'API'), N('db', 'db', 800, 300, 'DB')],
    edges: [E('e1', 'u', 'app'), E('e2', 'app', 'db')],
  });

  it('draws nodes, edges and labels with default view prefs', () => {
    const v = build(doc);
    expect(v.nodes.map((n) => n.id)).toEqual(['u', 'app', 'db']);
    const u = nodeOf(v, 'u');
    expect(u.load).toBeNull();
    expect(u.below?.text).toBe('12,000 users');
    expect(u.people.length).toBeGreaterThan(0);
    const app = nodeOf(v, 'app');
    expect(app.below?.text).toBe('16 vCPU · 64 GB');
    expect(app.label).toBe('API');
    expect(app.warn).toBeNull();
    expect(app.queue).toBeNull();
    expect(app.badge).toBeNull();
    expect(app.crosshair).toBe(false);
    expect(nodeOf(v, 'db').below?.text).toBe('DB · 16 vCPU · 64 GB');
    const e1 = edgeOf(v, 'e1');
    expect(e1.lines).toHaveLength(1);
    expect(e1.lines[0].packets.length).toBe(3);
    expect(e1.lines[0].path).toBeDefined();
    expect(e1.label).toBe('REST');
    expect(e1.showLabel).toBe(true);
    expect(e1.handles).toBeNull();
    // the busiest line is the thickest: here both lines carry all the traffic
    expect(e1.weight).toBeCloseTo(3.6, 5);
    expect(e1.tone).toBe('ok');
    expect(e1.tip).toBeNull();
    expect(v.rewire).toBeNull();
    expect(v.marquee).toBeNull();
    expect(v.flow).toEqual([]);
    expect(v.replication).toEqual([]);
  });

  it('straight route, paused, lesson mode hides labels', () => {
    const v = build(doc, { running: false, isLesson: true, view: { edges: 'all', route: 'straight', notes: 'open' } });
    const e = edgeOf(v, 'e1');
    expect(e.lines[0].path).toBeUndefined();
    expect(e.lines[0].packets).toEqual([]);
    expect(e.showLabel).toBe(false);
  });

  it('selected edge gets handles and shows its label in lesson mode; focus dims the rest', () => {
    const v = build(doc, { sel: { type: 'edge', id: 'e2' }, isLesson: true });
    const e2 = edgeOf(v, 'e2');
    expect(e2.selected).toBe(true);
    expect(e2.showLabel).toBe(true);
    expect(e2.handles).not.toBeNull();
    expect(e2.hl).toBe(true);
    expect(edgeOf(v, 'e1').dim).toBe(false); // touches app which is focused
    expect(nodeOf(v, 'u').dim).toBe(false);
  });

  it('read-only viewers get no handles', () => {
    const v = build(doc, { sel: { type: 'edge', id: 'e2' }, readOnly: true });
    expect(edgeOf(v, 'e2').handles).toBeNull();
  });

  it('selected node: selected flag and focus dimming', () => {
    const d = blankDoc({ ...doc, nodes: [...doc.nodes, N('x', 'app', 0, 900, 'Lonely')] });
    const v = build(d, { sel: { type: 'node', id: 'u' }, pending: 'u', tool: 'connect' });
    expect(nodeOf(v, 'u').selected).toBe(true);
    expect(nodeOf(v, 'u').pending).toBe(true);
    expect(nodeOf(v, 'u').crosshair).toBe(true);
    expect(nodeOf(v, 'x').dim).toBe(true);
    expect(nodeOf(v, 'db').dim).toBe(true);
    expect(edgeOf(v, 'e2').dim).toBe(true);
    expect(edgeOf(v, 'e1').hl).toBe(true);
  });

  it('multi selection lights connections between picked nodes', () => {
    const v = build(doc, { multi: [{ type: 'node', id: 'u' }, { type: 'node', id: 'app' }] });
    expect(edgeOf(v, 'e1').selected).toBe(true);
    expect(edgeOf(v, 'e2').selected).toBe(false);
  });

  it('hover lights connections; unknown hover id is ignored', () => {
    const v = build(doc, { hover: 'db' });
    expect(edgeOf(v, 'e2').hl).toBe(true);
    expect(edgeOf(v, 'e1').hl).toBe(false);
    const w = build(doc, { hover: 'nope' });
    expect(edgeOf(w, 'e2').hl).toBe(false);
  });

  it('marquee normalises the box', () => {
    const v = build(doc, { marquee: { x1: 50, y1: 80, x2: 10, y2: 20 } });
    expect(v.marquee).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it('skips edges whose ends are missing', () => {
    const d = blankDoc({ ...doc, edges: [...doc.edges, E('ghost', 'zzz', 'app')] });
    expect(build(d).edges.map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});

describe('edge labels, tags and packets', () => {
  const doc = blankDoc({
    nodes: [
      N('u', 'users', 0, 0, 'U'), N('gw', 'gateway', 300, 0, 'GW'), N('a', 'app', 600, 0, 'A'), N('b', 'app', 600, 300, 'B'),
      N('q', 'queue', 900, 0, 'Q'), N('w', 'worker', 1200, 0, 'W'),
    ],
    edges: [
      E('ug', 'u', 'gw'), E('ga', 'gw', 'a', { route: '/api' }), E('gb', 'gw', 'b', { op: 'read', calls: 3 }),
      E('aq', 'a', 'q', { mode: 'async', op: 'write' }), E('qw', 'q', 'w'),
    ],
  });

  it('labels show route, async and op; read edges are lighter; fan-out tag', () => {
    const v = build(doc);
    expect(edgeOf(v, 'ga').label).toBe('/api · REST');
    expect(edgeOf(v, 'aq').label).toBe('REST · async · write');
    expect(edgeOf(v, 'aq').async).toBe(true);
    expect(edgeOf(v, 'gb').read).toBe(true);
    expect(edgeOf(v, 'gb').label).toBe('REST · read');
    expect(edgeOf(v, 'gb').lines[0].tag?.text).toBe('3× per request');
    expect(edgeOf(v, 'gb').lines[0].tag?.hot).toBe(false);
    expect(edgeOf(v, 'ga').lines[0].tag).toBeUndefined();
  });

  it('breaker open and retry storm tags; open breaker stops packets', () => {
    const v = build(doc, {}, (s) => { s.breakerOpen.ga = true; s.retryAmp.gb = 2; });
    expect(edgeOf(v, 'ga').lines[0].tag).toMatchObject({ text: 'breaker open', hot: true });
    expect(edgeOf(v, 'ga').lines[0].packets).toEqual([]);
    expect(edgeOf(v, 'gb').lines[0].tag).toMatchObject({ text: 'retries ×2.0', hot: true });
  });

  it('packet counts follow rps; failing targets mark packets', () => {
    const v = build(doc, {}, (s) => {
      s.edgeRps.ug = 10000; s.edgeRps.ga = 1000; s.edgeRps.gb = 0.1; delete s.edgeRps.aq;
      s.load.a = 2; delete s.load.b;
    });
    expect(edgeOf(v, 'ug').lines[0].packets).toHaveLength(4);
    const ga = edgeOf(v, 'ga').lines[0].packets;
    expect(ga).toHaveLength(3);
    expect(ga.filter((p) => p.fail).length).toBe(2); // half of the traffic fails
    expect(edgeOf(v, 'gb').lines[0].packets).toHaveLength(0);
    expect(edgeOf(v, 'aq').lines[0].packets).toHaveLength(0);
  });

  it('an offline read-through cache passes traffic on: its packets do not fail', () => {
    const d = blankDoc({
      nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A'), N('c', 'cache', 600, 0, 'C', { down: true }), N('db', 'db', 900, 0, 'DB')],
      edges: [E('ua', 'u', 'a'), E('ac', 'a', 'c'), E('cd', 'c', 'db')],
    });
    const v = build(d);
    expect(edgeOf(v, 'ac').lines[0].packets.length).toBeGreaterThan(0);
    expect(edgeOf(v, 'ac').lines[0].packets.some((p) => p.fail)).toBe(false);
  });

  it('offline target fails every packet', () => {
    const d = structuredClone(doc);
    d.nodes.find((n) => n.id === 'a')!.down = true;
    const v = build(d);
    expect(edgeOf(v, 'ga').lines[0].packets.every((p) => p.fail)).toBe(true);
    expect(nodeOf(v, 'a').warn).toBe('node offline');
    expect(nodeOf(v, 'a').colors).toEqual(DOWN_COLORS);
    expect(nodeOf(v, 'a').load?.pct).toBe('offline');
  });
});

describe('load balancers', () => {
  const lbDoc = (algo: string, over: Partial<DesignNode> = {}, edgeOver = {}) => blankDoc({
    users: 12000,
    nodes: [
      N('u', 'users', 0, 300, 'U'), N('lb', 'lb', 300, 300, 'LB', { lbc: { algo: algo as never } }),
      N('app', 'app', 600, 300, 'App', { replicas: 3, ...over }), N('db', 'db', 1000, 300, 'DB'),
    ],
    edges: [E('ul', 'u', 'lb'), E('la', 'lb', 'app', edgeOver), E('ad', 'app', 'db')],
  });

  it('round robin: one line per replica with share tags and staggered packets', () => {
    const v = build(lbDoc('rr'));
    const la = edgeOf(v, 'la');
    expect(la.lines).toHaveLength(3);
    expect(la.lines[0].tag?.text).toBe('1 in 3 · 33%');
    expect(la.lines[1].packets.length).toBeGreaterThan(0);
    expect(la.lines[0].packets[0].tone).toBeUndefined();
    expect(nodeOf(v, 'lb').below?.text).toBe('LB · Round robin');
    // fanned app: three positions, extras, label A
    const app = nodeOf(v, 'app');
    expect(app.label).toBe('App A');
    expect(app.extras).toHaveLength(2);
    expect(app.extras[1].below?.text).toBe('16 vCPU · 64 GB · ×3');
    expect(app.extras[0].below).toBeNull();
    expect(app.below).toBeNull();
    // fanned source: one line from each replica, only the first gets a tag
    const ad = edgeOf(v, 'ad');
    expect(ad.lines).toHaveLength(3);
  });

  it('weighted, least connections and hash tags', () => {
    expect(edgeOf(build(lbDoc('wrr', {}, { weight: 0 })), 'la').lines[0].tag?.text).toMatch(/^w1 · /);
    expect(edgeOf(build(lbDoc('wrr', {}, { weight: 4 })), 'la').lines[0].tag?.text).toMatch(/^w4 · /);
    expect(edgeOf(build(lbDoc('lc')), 'la').lines[0].tag?.text).toMatch(/conns · \d+%$/);
    const lcNoLat = build(lbDoc('lc'), {}, (s) => { delete s.nodeLatency.app; });
    expect(edgeOf(lcNoLat, 'la').lines[0].tag?.text).toMatch(/conns/);
    const hash = build(lbDoc('hash'));
    expect(edgeOf(hash, 'la').lines[0].tag?.text).toMatch(/% of users$/);
    expect(edgeOf(hash, 'la').lines[0].packets[0].tone).toBe(0);
    // clients entering an IP-hash balancer are coloured too
    expect(edgeOf(hash, 'ul').lines[0].packets.map((p) => p.tone)).toEqual([0, 1, 2]);
    expect(nodeOf(hash, 'lb').below?.text).toBe('LB · IP hash');
  });

  it('unknown algorithm has no name', () => {
    const v = build(lbDoc('zzz'));
    expect(nodeOf(v, 'lb').below?.text).toBe('LB');
  });

  it('overloaded backend tags are hot; paused LB draws no packets', () => {
    const v = build(lbDoc('rr'), { running: false }, (s) => { s.repLoad.app = [2, 2, 2]; });
    const l0 = edgeOf(v, 'la').lines[0];
    expect(l0.tag?.hot).toBe(true);
    expect(l0.packets).toEqual([]);
  });

  it('missing per-replica data falls back to zero', () => {
    const v = build(lbDoc('rr'), {}, (s) => {
      s.edgeRepRps.la = [5];
      delete s.repLoad.app;
      s.lbBackends.lb = s.lbBackends.lb.slice(0, 1);
    });
    const la = edgeOf(v, 'la');
    expect(la.lines).toHaveLength(3);
    expect(la.lines[1].packets).toEqual([]);
    expect(la.lines[0].tag).toBeUndefined(); // only one live backend left
  });

  it('LB with no backend stats and edges to missing nodes', () => {
    const d = lbDoc('rr');
    d.edges.push(E('lghost', 'lb', 'nowhere'));
    const v = build(d, {}, (s) => { delete s.lbBackends.lb; });
    expect(edgeOf(v, 'la').lines.every((l) => l.packets.length === 0)).toBe(true);
  });

  it('down backend gets no packets', () => {
    const d = blankDoc({
      nodes: [N('u', 'users', 0, 0, 'U'), N('lb', 'lb', 300, 0, 'LB'), N('a', 'app', 600, 0, 'A'), N('b', 'app', 600, 300, 'B', { down: true })],
      edges: [E('ul', 'u', 'lb'), E('la', 'lb', 'a'), E('lbb', 'lb', 'b')],
    });
    const v = build(d);
    expect(edgeOf(v, 'lbb').lines[0].packets).toEqual([]);
    expect(edgeOf(v, 'lbb').lines[0].packets.every((p) => p.fail)).toBe(true);
    // two targets: share in the label
    expect(edgeOf(v, 'la').label).toBe('REST · 100%');
    expect(edgeOf(v, 'lbb').label).toBe('REST · 0%');
  });

  it('LB share is 0% when there is no traffic, and tolerates missing edge rps', () => {
    const d = blankDoc({
      users: 0,
      nodes: [N('u', 'users', 0, 0, 'U'), N('lb', 'lb', 300, 0, 'LB'), N('a', 'app', 600, 0, 'A'), N('b', 'app', 600, 300, 'B')],
      edges: [E('ul', 'u', 'lb'), E('la', 'lb', 'a'), E('lbb', 'lb', 'b')],
    });
    expect(edgeOf(build(d), 'la').label).toBe('REST · 0%');
    const v = build({ ...d, users: 1000 }, {}, (s) => { delete s.edgeRps.la; });
    expect(edgeOf(v, 'lbb').label).toBe('REST · 100%');
  });

  it('LB into a replicated database: one line per primary/replica, shares by edge', () => {
    const d = blankDoc({
      nodes: [N('u', 'users', 0, 0, 'U'), N('lb', 'lb', 300, 0, 'LB'), N('db', 'db', 600, 0, 'DB', { dbc: { replicas: 1 } })],
      edges: [E('ul', 'u', 'lb'), E('ld', 'lb', 'db')],
    });
    const v = build(d);
    expect(edgeOf(v, 'ld').lines).toHaveLength(2);
  });

  it('draining replica retracts the last line in and out', () => {
    const d = lbDoc('rr');
    const v = build(d, { drain: { app: 1 } });
    const la = edgeOf(v, 'la');
    expect(la.lines[2].retract).toBe(true);
    expect(la.lines[2].packets).toEqual([]);
    expect(la.lines[2].path).toBeUndefined();
    expect(edgeOf(v, 'ad').lines[2].retract).toBe(true);
    const app = nodeOf(v, 'app');
    expect(app.extras[1].draining).toBe(true);
    expect(app.extras[1].load.pct).toBe('draining');
  });

  it('a "draining" multi-position node with no replica count in the sim retracts its last line', () => {
    // sharded db: two positions without a replica count (drain is keyed by node id)
    const d = blankDoc({
      nodes: [N('a', 'app', 0, 0, 'A'), N('db', 'db', 400, 0, 'DB', { dbc: { shards: 2 } })],
      edges: [E('ad', 'a', 'db', { op: 'write' })],
    });
    const v = build(d, { drain: { db: 1 } }, (s) => { delete s.reps.db; });
    expect(edgeOf(v, 'ad').lines.map((l) => l.retract)).toEqual([false, true]);
  });

  it('more replicas than shown; horizontal autoscale text', () => {
    const v = build(lbDoc('rr', { replicas: 10 }));
    expect(nodeOf(v, 'app').extras.at(-1)!.below?.text).toBe('16 vCPU · 64 GB · ×10 · +2 more');
    const auto = build(lbDoc('rr', { autoscale: autoH(2, 10) }));
    expect(nodeOf(auto, 'app').extras.at(-1)!.below?.text).toBe('16 vCPU · 64 GB · auto ×2 (2–10)');
    const one = build(lbDoc('rr', { autoscale: autoH(1, 10) }));
    expect(nodeOf(one, 'app').below?.text).toBe('16 vCPU · 64 GB · auto ×1');
  });

  it('hot fanned node and hit-max warning', () => {
    const v = build(lbDoc('rr', { autoscale: autoH(2, 2) }), {}, (s) => { s.load.app = 3; s.repLoad.app = [3, 3]; });
    const app = nodeOf(v, 'app');
    expect(app.warn).toBe('hit max replicas');
    expect(app.hot).toBe(true);
    expect(app.colors).toEqual(HOT_COLORS);
    expect(app.extras[0].colors).toEqual(HOT_COLORS);
  });

  it('down fanned node colours every replica grey', () => {
    const v = build(lbDoc('rr', { down: true }));
    expect(nodeOf(v, 'app').extras[0].colors).toEqual(DOWN_COLORS);
  });

  it('non-balancer caller into a fanned node draws one line', () => {
    const d = lbDoc('rr');
    d.nodes.push(N('cron', 'app', 600, 800, 'Cron'));
    d.edges.push(E('ca', 'cron', 'app'));
    expect(edgeOf(build(d), 'ca').lines).toHaveLength(1);
  });
});

describe('queues', () => {
  const doc = blankDoc({
    nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A'), N('q', 'queue', 600, 0, 'Q'), N('w', 'worker', 900, 0, 'W', { replicas: 2 })],
    edges: [E('ua', 'u', 'a'), E('aq', 'a', 'q', { mode: 'async' }), E('qw', 'q', 'w')],
  });
  const q = (stat: Partial<SimResult['queue'][string]> | null, down = false, running = true) => {
    const d = structuredClone(doc);
    d.nodes[2].down = down;
    return nodeOf(build(d, { running }, (s) => {
      if (stat === null) delete s.queue.q;
      else s.queue.q = { depth: 0, inRate: 0, outRate: 0, drainCap: 100, growth: 0, full: false, consumers: 1, ...stat };
    }), 'q');
  };

  it('queue into a fanned worker draws a line per worker', () => {
    const v = build(doc);
    expect(edgeOf(v, 'qw').lines).toHaveLength(2);
    expect(nodeOf(v, 'q').queue?.flowing).toBe(true);
  });

  it('states and warnings', () => {
    expect(q(null).queue).toMatchObject({ state: 'empty', filled: 0, flowing: false });
    expect(q(null).below?.text).toBe('Q · idle');
    expect(q({ inRate: 5, consumers: 0 }).warn).toBe('no consumer · messages pile up');
    expect(q({ inRate: 5 }).below?.text).toBe('Q · 5/s flowing');
    const full = q({ depth: 1_000_000, full: true });
    expect(full.queue?.state).toBe('full');
    expect(full.warn).toBe('queue full · rejecting messages');
    expect(full.load?.hot).toBe(true);
    expect(full.below?.text).toBe('Q · full');
    const grow = q({ depth: 100, growth: 20 });
    expect(grow.queue?.state).toBe('growing');
    expect(grow.below?.text).toBe('Q · +20/s');
    const drain = q({ depth: 100, growth: -30, outRate: 30 });
    expect(drain.queue?.state).toBe('draining');
    expect(drain.below?.text).toBe('Q · empty in ~4s');
    const steady = q({ depth: 100 });
    expect(steady.queue).toMatchObject({ state: 'steady', filled: 2 });
    const down = q({ depth: 100, full: true, inRate: 5, consumers: 0 }, true);
    expect(down.queue?.state).toBe('down');
    expect(down.load?.pct).toBe('offline');
    expect(down.warn).toBe('node offline');
    expect(q({ inRate: 5 }, false, false).queue?.flowing).toBe(false);
  });
});

describe('warnings and node text', () => {
  const one = (n: DesignNode, mut?: (s: SimResult, id: string) => void, extra: DesignNode[] = [], edges = [] as ReturnType<typeof E>[]) => {
    const d = blankDoc({ nodes: [n, ...extra], edges });
    return nodeOf(build(d, {}, mut ? (s) => mut(s, n.id) : undefined), n.id);
  };

  it('cache warnings', () => {
    const db = N('db', 'db', 300, 0, 'DB');
    expect(one(N('c', 'cache', 0, 0, 'C', { down: true }), undefined, [db], [E('cd', 'c', 'db')]).warn).toBe('offline · reads fall through to DB');
    expect(one(N('c', 'cache', 0, 0, 'C', { down: true })).warn).toBe('offline · reads fail (no DB behind it)');
    expect(one(N('c', 'cache', 0, 0, 'C'), (s, id) => { s.cacheRefill[id] = false; s.cacheHit[id] = 0.4; }).warn).toBe('DB offline · keys expiring · 40% hits');
    expect(one(N('c', 'cache', 0, 0, 'C'), (s, id) => { s.cacheRefill[id] = false; delete s.cacheHit[id]; }).warn).toBe('DB offline · cache empty');
    expect(one(N('c', 'cache', 0, 0, 'C'), (s, id) => { s.cacheHit[id] = 0.3; }).warn).toBe('warming up · 30% hits');
    expect(one(N('c', 'cache', 0, 0, 'C'), (s, id) => { delete s.cacheHit[id]; }).warn).toBeNull();
  });

  it('database connections, needs-LB, overload variants', () => {
    expect(one(N('d', 'db', 0, 0, 'D'), (s, id) => { s.dbConns[id] = { need: 500, limit: 100 }; }).warn).toBe('too many connections · 500/100');
    expect(one(N('d', 'db', 0, 0, 'D'), (s, id) => { s.dbConns[id] = { need: 50, limit: 100 }; }).warn).toBeNull();
    const u = N('u', 'users', 0, 0, 'U');
    const needs = one(N('a', 'app', 300, 0, 'A', { replicas: 2 }), undefined, [u], [E('ua', 'u', 'a')]);
    expect(needs.warn).toBe('needs a load balancer');
    expect(needs.below?.text).toBe('16 vCPU · 64 GB');
    expect(one(N('x', 'ext', 0, 0, 'X'), (s, id) => { s.load[id] = 2; }).warn).toBe('rate limited');
    expect(one(N('x', 'ext', 0, 0, 'X')).dashed).toBe(true);
    expect(one(N('a', 'app', 0, 0, 'A', { size: 4 }), (s, id) => { s.load[id] = 2; }).warn).toBe('largest machine you can buy');
    expect(one(N('a', 'app', 0, 0, 'A'), (s, id) => { s.load[id] = 2; }).warn).toBe('over capacity');
    const busy = one(N('a', 'app', 0, 0, 'A'), (s, id) => { s.load[id] = 0.8; });
    expect(busy.load?.color).toBe('#e09a2c');
    expect(busy.hot).toBe(false);
  });

  it('vertical autoscale text and missing sim entries', () => {
    expect(one(N('a', 'app', 0, 0, 'A', { autoscale: autoV(1, 4) })).below?.text).toBe('8 vCPU · 32 GB · auto-size');
    const bare = one(N('a', 'app', 0, 0, 'A', { size: 1 }), (s, id) => { delete s.sizeIdx[id]; delete s.reps[id]; delete s.load[id]; });
    expect(bare.below?.text).toBe('8 vCPU · 32 GB');
  });

  it('ghost stacks for unscaled cubes', () => {
    expect(one(N('c', 'cdn', 0, 0, 'C', { replicas: 3 })).ghostStack).toBe(2);
    expect(one(N('c', 'cdn', 0, 0, 'C', { replicas: 2 })).ghostStack).toBe(1);
    expect(one(N('c', 'cdn', 0, 0, 'C')).ghostStack).toBe(0);
    expect(one(N('c', 'cdn', 0, 0, 'C', { replicas: 2 })).below?.text).toBe('×2');
  });

  it('database partitions and clusters', () => {
    expect(one(N('d', 'db', 0, 0, 'D', { dbc: { partition: 'time' } })).below?.text).toBe('D · 16 vCPU · 64 GB · 12 partitions by created_at');
    const hash = one(N('d', 'db', 0, 0, 'D', { dbc: { shards: 6, replicas: 4, partition: 'hash' } }));
    expect(hash.below?.text).toBe('Shard 1 · hash(user_id) % 6 = 0 · 12 partitions by created_at · +2 shards · +1 replicas');
    expect(hash.bands).toBe(true);
    expect(hash.extras.filter((x) => x.key.includes('-s'))).toHaveLength(3);
    const rep = hash.extras.find((x) => x.key === 'd-r0-0')!;
    expect(rep.below).toEqual({ text: 'read replicas ×4 · async', info: true });
    expect(rep.colors).toEqual(REPLICA_COLORS);
    expect(hash.extras.find((x) => x.key === 'd-r0-1')!.below).toBeNull();
    const geo = one(N('d', 'db', 0, 0, 'D', { dbc: { shards: 2, strategy: 'geo' } }));
    expect(geo.extras[0].below?.text).toBe('Shard 2 · US');
    const range = one(N('d', 'db', 0, 0, 'D', { dbc: { shards: 2, strategy: 'range' } }));
    expect(range.below?.text).toBe('Shard 1 · user_id range 1/2');
    const single = one(N('d', 'db', 0, 0, 'D', { dbc: { replicas: 1, sync: true } }), (s, id) => { delete s.dbLoad[id]; });
    expect(single.below?.text).toBe('D · primary');
    expect(single.extras[0].below?.text).toBe('read replica · sync');
    expect(single.load?.pct).toBe('0%');
    const down = one(N('d', 'db', 0, 0, 'D', { down: true, dbc: { replicas: 1 } }));
    expect(down.extras[0].colors).toEqual(DOWN_COLORS);
  });
});

describe('database edges and replication', () => {
  const doc = (dbc: object, op: 'read' | 'write' | 'both', users = 12000, down = false) => blankDoc({
    users,
    nodes: [N('u', 'users', -400, 0, 'U'), N('a', 'app', 0, 0, 'A'), N('d', 'db', 400, 0, 'D', { dbc, down })],
    edges: [E('ua', 'u', 'a'), E('ad', 'a', 'd', { op })],
  });

  it('reads go to replicas, writes to primaries', () => {
    expect(edgeOf(build(doc({ replicas: 2 }, 'read')), 'ad').lines).toHaveLength(2);
    expect(edgeOf(build(doc({ replicas: 2 }, 'write')), 'ad').lines).toHaveLength(1);
    expect(edgeOf(build(doc({ replicas: 2 }, 'both')), 'ad').lines).toHaveLength(3);
    // sharded without replicas: reads still go to every primary
    expect(edgeOf(build(doc({ shards: 2 }, 'read')), 'ad').lines).toHaveLength(2);
  });

  it('replication lines animate only while live', () => {
    const v = build(doc({ replicas: 2, sync: true }, 'both'));
    expect(v.replication).toHaveLength(2);
    expect(v.replication[0].sync).toBe(true);
    expect(v.replication[0].packets).toHaveLength(2);
    expect(v.replication[0].packets[0].dur).toBe('0.70');
    const async = build(doc({ replicas: 1 }, 'both'));
    expect(async.replication[0].packets[0].dur).toBe('1.80');
    expect(build(doc({ replicas: 1 }, 'both'), { running: false }).replication[0].packets).toEqual([]);
    expect(build(doc({ replicas: 1 }, 'both', 12000, true)).replication[0].packets).toEqual([]);
    expect(build(doc({ replicas: 1 }, 'both', 0)).replication[0].packets).toEqual([]);
    expect(build(doc({ replicas: 1 }, 'both'), {}, (s) => { delete s.inflow.d; }).replication[0].packets).toEqual([]);
  });
});

describe('shared infrastructure (hubs)', () => {
  // four services all calling the same five shared things, plus one service inside a collapsed group
  const svc = ['s1', 's2', 's3', 's4'];
  const hubs = [N('redis', 'cache', 600, 0, 'Redis'), N('mongo', 'db', 600, 200, 'Mongo'), N('s3', 'store', 600, 400, 'S3'), N('mail', 'ext', 600, 600, 'Mail'), N('kafka', 'queue', 600, 800, 'Kafka')];
  const doc = blankDoc({
    nodes: [N('u', 'users', -400, 0, 'U'), ...svc.map((id, i) => N(id, 'app', 0, i * 200, id.toUpperCase())), ...hubs],
    edges: [
      ...svc.map((id) => E(`u-${id}`, 'u', id)),
      ...svc.flatMap((id) => hubs.map((h) => E(`${id}-${h.id}`, id, h.id))),
    ],
  });

  it('hides lines into hubs behind chips and counts callers', () => {
    const v = build(doc);
    expect(v.edges.some((e) => e.id === 's1-redis')).toBe(false);
    const s1 = nodeOf(v, 's1');
    expect(s1.chips.map((c) => c.text)).toEqual(['Redis', 'Mongo', 'S3', '+2']);
    expect(s1.chips[3].hot).toBe(false);
    expect(nodeOf(v, 'redis').chips[0]).toEqual({ key: 'callers', text: '← 4 callers', hot: false });
  });

  it('hot chips: an offline or overloaded hub', () => {
    const d = structuredClone(doc);
    d.nodes.find((n) => n.id === 'kafka')!.down = true;
    const v = build(d, {}, (s) => { s.load.redis = 3; });
    const s1 = nodeOf(v, 's1');
    expect(s1.chips[0].hot).toBe(true);
    expect(s1.chips[3].hot).toBe(true);
  });

  it('chip label falls back to the id when the sim does not know the node', () => {
    const v = build(doc, {}, (s) => { s.byId = new Map(s.byId); s.byId.delete('redis'); delete s.load.mongo; });
    expect(nodeOf(v, 's1').chips[1]).toMatchObject({ text: 'Mongo', hot: false });
    expect(nodeOf(v, 's1').chips[0]).toMatchObject({ text: 'redis', hot: false });
  });

  it('view "all" shows every line', () => {
    const v = build(doc, { view: { edges: 'all', route: 'elbow', notes: 'icons' } });
    expect(v.edges.some((e) => e.id === 's1-redis')).toBe(true);
    expect(nodeOf(v, 's1').chips).toEqual([]);
  });

  it('selecting, hovering, rewiring or a flow reveals hidden lines', () => {
    expect(build(doc, { sel: { type: 'node', id: 's1' } }).edges.some((e) => e.id === 's1-redis')).toBe(true);
    expect(build(doc, { sel: { type: 'edge', id: 's2-redis' } }).edges.some((e) => e.id === 's2-redis')).toBe(true);
    const hov = build(doc, { hover: 's3' });
    expect(edgeOf(hov, 's3-redis').hl).toBe(true);
    const rw = build(doc, { rewire: { edgeId: 's4-redis', end: 'to', x: 10, y: 10, over: null } });
    expect(edgeOf(rw, 's4-redis').dim).toBe(true);
    const d = structuredClone(doc);
    d.flows = [{ id: 'f', name: 'F', steps: ['u', 's1', 'mongo'] }];
    const fl = build(d, { recording: 'f' });
    expect(fl.edges.some((e) => e.id === 's1-mongo')).toBe(true);
    expect(fl.edges.some((e) => e.id === 's2-mongo')).toBe(false);
  });
});

describe('collapsed groups', () => {
  const doc = blankDoc({
    nodes: [
      N('u', 'users', -400, 100, 'U'),
      N('a', 'app', 100, 100, 'A'), N('b', 'app', 200, 200, 'B'),
      N('c', 'db', 700, 100, 'C'),
      N('x', 'app', 1200, 100, 'X'),
    ],
    edges: [
      E('ua', 'u', 'a'), E('ub', 'u', 'b'), E('ab', 'a', 'b'), E('ac', 'a', 'c'), E('bx', 'b', 'x'),
      E('ghost', 'zzz', 'a'),
    ],
    groups: [
      { id: 'g1', label: 'G1', x: 0, y: 0, w: 400, h: 400, color: 'green', collapsed: true },
      { id: 'g2', label: 'G2', x: 600, y: 0, w: 300, h: 300, color: 'purple' as never, collapsed: true },
      { id: 'g3', label: 'G3', x: 1100, y: 0, w: 300, h: 300, color: 'orange' },
    ],
    notes: [{ id: 't1', text: 'in', x: 50, y: 50 }, { id: 't2', text: '   ', x: 2000, y: 0 }, { id: 't3', text: 'hello', x: 2100, y: 0 }],
  });

  it('hides members, merges connections and summarises cards', () => {
    const v = build(doc);
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['u', 'x']);
    expect(v.notes.map((n) => n.id)).toEqual(['t2', 't3']);
    const ua = edgeOf(v, 'ua');
    expect(ua.label).toBe('2 connections');
    expect(ua.weight).toBeGreaterThanOrEqual(2);
    expect(ua.lines[0].packets.length).toBeGreaterThan(0);
    expect(v.edges.some((e) => e.id === 'ub')).toBe(false); // merged into ua
    expect(v.edges.some((e) => e.id === 'ab')).toBe(false); // internal
    expect(edgeOf(v, 'ac').label).toBe('REST'); // group to group, one connection
    expect(edgeOf(v, 'bx').weight).toBeGreaterThanOrEqual(1);
    const g1 = v.groups.find((g) => g.id === 'g1')!;
    expect(g1.collapsed).toBe(true);
    expect(g1.w).toBe(GROUP_CARD.w);
    expect(g1.border).toBe(GROUP_COLORS.green.border);
    expect(g1.summary?.parts).toBe('2 components · 1 note');
    expect(g1.summary?.status).toMatch(/^healthy · busiest /);
    expect(g1.summary?.traffic).toMatch(/rps in$/);
    expect(g1.summary?.bad).toBe(false);
    const g2 = v.groups.find((g) => g.id === 'g2')!;
    expect(g2.border).toBe(GROUP_COLORS.blue.border);
    expect(g2.bg).toBe(GROUP_COLORS.blue.bg);
    const g3 = v.groups.find((g) => g.id === 'g3')!;
    expect(g3.summary).toBeNull();
    expect(g3.w).toBe(300);
  });

  it('notes open when the view says so, when selected or when empty', () => {
    expect(build(doc).notes.map((n) => n.open)).toEqual([true, false]);
    expect(build(doc, { sel: { type: 'note', id: 't3' } }).notes[1]).toMatchObject({ open: true, selected: true });
    expect(build(doc, { view: { edges: 'smart', route: 'elbow', notes: 'open' } }).notes[1].open).toBe(true);
  });

  it('focus through a collapsed group keeps merged lines lit', () => {
    const v = build(doc, { sel: { type: 'node', id: 'c' } });
    expect(edgeOf(v, 'ua').dim).toBe(false);
    expect(edgeOf(v, 'bx').dim).toBe(true);
    expect(v.groups.find((g) => g.id === 'g1')!.selected).toBe(false);
    const g = build(doc, { sel: { type: 'group', id: 'g1' } });
    expect(g.groups.find((x) => x.id === 'g1')!.selected).toBe(true);
  });

  it('a selected merged line gets no handles', () => {
    const v = build(doc, { sel: { type: 'edge', id: 'ua' } });
    expect(edgeOf(v, 'ua').handles).toBeNull();
  });

  it('status: overloaded, offline, empty; nested groups and notes', () => {
    const hot = build(doc, {}, (s) => { s.load.a = 2; });
    expect(hot.groups[0].summary).toMatchObject({ status: '1 overloaded · A 200%', bad: true });
    const d = structuredClone(doc);
    d.nodes.find((n) => n.id === 'c')!.down = true;
    expect(build(d).groups.find((g) => g.id === 'g2')!.summary).toMatchObject({ status: '1 offline · C', bad: true });
    const e = blankDoc({
      nodes: [N('u', 'users', 50, 50, 'U')],
      groups: [
        { id: 'outer', label: 'O', x: 0, y: 0, w: 500, h: 500, color: 'blue', collapsed: true },
        { id: 'inner', label: 'I', x: 100, y: 100, w: 50, h: 50, color: 'blue' },
        { id: 'inner2', label: 'I2', x: 200, y: 200, w: 50, h: 50, color: 'blue' },
      ],
      notes: [{ id: 'n1', text: 'a', x: 10, y: 10 }, { id: 'n2', text: 'b', x: 20, y: 20 }],
    });
    const ev = build(e, {}, (s) => { delete s.load.u; });
    expect(ev.groups).toHaveLength(1);
    expect(ev.groups[0].summary).toMatchObject({ parts: '1 component · 2 notes · 2 groups', status: 'empty', traffic: '' });
    const empty = build(blankDoc({ groups: [{ id: 'g', label: 'G', x: 0, y: 0, w: 10, h: 10, color: 'blue', collapsed: true }] }));
    expect(empty.groups[0].summary?.parts).toBe('0 components');
  });

  it('missing load / edge rps inside a card count as zero', () => {
    const v = build(doc, {}, (s) => { delete s.load.a; delete s.load.b; delete s.edgeRps.ua; delete s.edgeRps.ub; });
    expect(v.groups[0].summary?.status).toBe('healthy · busiest A 0%');
    expect(v.groups[0].summary?.traffic).toBe('');
  });

  it('collapsed db cluster has no replication lines; flows attach to cards', () => {
    const d = blankDoc({
      nodes: [N('a', 'app', -400, 0, 'A'), N('d', 'db', 50, 50, 'D', { dbc: { replicas: 1 } })],
      edges: [E('ad', 'a', 'd')],
      groups: [{ id: 'g', label: 'G', x: 0, y: 0, w: 300, h: 300, color: 'blue', collapsed: true }],
      flows: [{ id: 'f', name: 'F', steps: ['a', 'd'] }],
    });
    const v = build(d, { flowPlay: { id: 'f', idx: 0, playing: true } });
    expect(v.replication).toEqual([]);
    expect(v.flow.length).toBeGreaterThan(0);
    expect(edgeOf(v, 'ad').lines).toHaveLength(1);
  });
});

describe('rewire drag', () => {
  const doc = blankDoc({
    nodes: [N('a', 'app', 0, 0, 'A'), N('b', 'app', 400, 0, 'B'), N('c', 'app', 400, 400, 'C')],
    edges: [E('ab', 'a', 'b'), E('ac', 'a', 'c'), E('ghost', 'zzz', 'b')],
  });

  it('ghost line from the fixed end; drop targets ok / bad', () => {
    const ok = build(doc, { rewire: { edgeId: 'ab', end: 'to', x: 200, y: 300, over: 'a' } });
    expect(nodeOf(ok, 'a').drop).toBe('bad'); // self loop
    expect(nodeOf(ok, 'b').drop).toBeNull();
    expect(ok.rewire?.valid).toBe(false);
    expect(ok.rewire).toMatchObject({ x: 0, y: 0, dotX: 200, dotY: 300 });
    expect(edgeOf(ok, 'ab').dim).toBe(true);
    expect(edgeOf(ok, 'ab').handles).toBeNull();
    const good = build(doc, { sel: { type: 'edge', id: 'ab' }, rewire: { edgeId: 'ab', end: 'from', x: 10, y: 20, over: 'c' } });
    expect(nodeOf(good, 'c').drop).toBe('ok');
    expect(good.rewire).toMatchObject({ x: 10, y: 20, valid: true });
    expect(nodeOf(good, 'a').dim).toBe(false); // no focus dimming while dragging
    const free = build(doc, { rewire: { edgeId: 'ab', end: 'to', x: 1, y: 1, over: null } });
    expect(free.rewire?.valid).toBe(true);
  });

  it('unknown edge or missing fixed end draws no ghost', () => {
    expect(build(doc, { rewire: { edgeId: 'nope', end: 'to', x: 0, y: 0, over: 'a' } }).rewire).toBeNull();
    expect(nodeOf(build(doc, { rewire: { edgeId: 'nope', end: 'to', x: 0, y: 0, over: 'a' } }), 'a').drop).toBeNull();
    expect(build(doc, { rewire: { edgeId: 'ghost', end: 'to', x: 0, y: 0, over: null } }).rewire).toBeNull();
  });
});

describe('flows', () => {
  const doc = blankDoc({
    nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 400, 0, 'A'), N('b', 'app', 400, 300, 'B'), N('c', 'app', 800, 300, 'C')],
    edges: [E('ua', 'u', 'a'), E('ab', 'a', 'b'), E('bc', 'b', 'c')],
    flows: [{ id: 'f', name: 'F', steps: ['u', 'a', 'zzz', 'b', 'c', 'a'] }],
  });

  it('recording draws "rec" segments and step badges', () => {
    const v = build(doc, { recording: 'f' });
    expect(v.flow.every((s) => s.state === 'rec' && !s.token)).toBe(true);
    expect(nodeOf(v, 'a').badge).toBe('2,6');
    expect(nodeOf(v, 'a').crosshair).toBe(true);
    expect(nodeOf(v, 'a').dim).toBe(false);
  });

  it('playback marks past / current / next, dims non-steps and edges', () => {
    const d = structuredClone(doc);
    d.nodes.push(N('x', 'app', 0, 900, 'X'));
    const v = build(d, { flowPlay: { id: 'f', idx: 3, playing: true }, sel: { type: 'node', id: 'x' } });
    const states = new Set(v.flow.map((s) => s.state));
    expect(states).toEqual(new Set(['past', 'cur', 'next']));
    expect(v.flow.filter((s) => s.token)).toHaveLength(1);
    expect(nodeOf(v, 'x').dim).toBe(true);
    expect(nodeOf(v, 'u').dim).toBe(false);
    expect(edgeOf(v, 'ua').dim).toBe(true);
  });

  it('straight route flows have one segment per hop; unknown flow ids draw nothing', () => {
    const v = build(doc, { recording: 'f', view: { edges: 'smart', route: 'straight', notes: 'icons' } });
    expect(v.flow).toHaveLength(3);
    expect(build(doc, { flowPlay: { id: 'nope', idx: 0, playing: true } }).flow).toEqual([]);
  });
});
