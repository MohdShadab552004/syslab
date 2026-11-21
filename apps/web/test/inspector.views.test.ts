import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DesignDoc, DesignNode } from '@syslab/types';
import {
  EMPTY_RUNTIME, KINDS, LB_ALGOS, QUEUE_MAX, SIZES, TECHS, autoH, autoV, blankDoc, makeEdge, makeNode, simulate,
  type Runtime, type SimResult,
} from '@syslab/sim';
import type { EditorActions } from '@/hooks/editor/editor.store';
import { edgeView, nodeView } from '@/hooks/editor/useInspector';

const N = makeNode, E = makeEdge;
type Actions = EditorActions & Record<string, Mock>;

function mockActions(): Actions {
  const fns: Record<string, Mock> = {};
  return new Proxy(fns, { get: (t, k: string) => (t[k] ??= vi.fn()) }) as unknown as Actions;
}
const rt = (p: Partial<Runtime>): Runtime => ({ ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {}, ...p });

interface Opt { rt?: Runtime; mut?: (s: SimResult) => void }
function nv(doc: DesignDoc, id: string, opt: Opt = {}) {
  const sim = simulate(doc, opt.rt);
  opt.mut?.(sim);
  const a = mockActions();
  return { v: nodeView(doc.nodes.find((n) => n.id === id)!, doc, sim, a), a, sim };
}
function ev(doc: DesignDoc, id: string, opt: Opt = {}) {
  const sim = simulate(doc, opt.rt);
  opt.mut?.(sim);
  const a = mockActions();
  return { v: edgeView(doc.edges.find((e) => e.id === id)!, doc, sim, a), a, sim };
}

/** users → app → db, with the app configurable */
const chain = (app: Partial<DesignNode> = {}, users = 12000, db: Partial<DesignNode> = {}) => blankDoc({
  users,
  nodes: [N('u', 'users', 0, 0, 'Users'), N('a', 'app', 300, 0, 'API', app), N('d', 'db', 600, 0, 'DB', db)],
  edges: [E('ua', 'u', 'a'), E('ad', 'a', 'd'), E('ghost', 'a', 'zzz')],
});
/** users → lb → app (horizontally scalable) */
const behindLb = (app: Partial<DesignNode> = {}, users = 12000) => blankDoc({
  users,
  nodes: [N('u', 'users', 0, 0, 'U'), N('lb', 'lb', 300, 0, 'LB'), N('a', 'app', 600, 0, 'App', app)],
  edges: [E('ul', 'u', 'lb'), E('la', 'lb', 'a')],
});

/* ------------------------------------------------------------------ */

describe('nodeView: common parts', () => {
  it('app with defaults', () => {
    const { v, a } = nv(chain(), 'a');
    expect(v).toMatchObject({ id: 'a', kindName: 'App Server', name: 'API', downLabel: 'Take offline', needsLB: null, db: null, lb: null, cache: null, queue: null });
    expect(v.tile).toBe(KINDS.app.colors[1]);
    expect(v.state).toEqual({ text: 'Healthy', bad: false });
    expect(v.tech).toMatchObject({ value: 'Node.js', options: TECHS.app });
    expect(v.sizes).toHaveLength(SIZES.length);
    expect(v.sizes!.find((s) => s.active)!.key).toBe('2');
    expect(v.sizes![0].sub).toBe('$60/mo');
    expect(v.connections.map((c) => c.text)).toEqual(['← Users · REST', '→ DB · REST']);
    expect(v.stats).toMatchObject({ incoming: '720 rps', capacity: '2.4k rps' });
    expect(v.stats!.latency).toMatch(/ ms$/);
    expect(v.perf!.note).toBe('Single-threaded event loop per process; great for I/O-heavy APIs. These are estimates; type numbers from a load test to replace them.');
    expect(v.perf!.measured).toMatchObject({ rps: '', ms: '', estRps: '2,400', estMs: '38', onClear: null });
    expect(v.perf!.workers).toMatch(/ × 38 ms$/);
    // callbacks
    v.onRename('X'); expect(a.updateNode).toHaveBeenLastCalledWith('a', { label: 'X' });
    v.tech.onChange('Go'); expect(a.updateNode).toHaveBeenLastCalledWith('a', { tech: 'Go' });
    v.sizes![3].onSelect(); expect(a.updateNode).toHaveBeenLastCalledWith('a', { size: 3 });
    v.replicas!.onInc(); expect(a.updateNode).toHaveBeenLastCalledWith('a', { replicas: 2 });
    v.replicas!.onDec(); expect(a.updateNode).toHaveBeenLastCalledWith('a', { replicas: 1 });
    v.connections[1].onRemove(); expect(a.deleteEdge).toHaveBeenLastCalledWith('ad');
    v.onToggleDown(); expect(a.toggleDown).toHaveBeenCalledWith('a');
    v.onDelete(); expect(a.deleteNode).toHaveBeenCalledWith('a');
    v.perf!.measured.onRps('1,200'); expect(a.updateNode).toHaveBeenLastCalledWith('a', { measured: { rps: 1200 } });
    v.perf!.measured.onMs('abc'); expect(a.updateNode).toHaveBeenLastCalledWith('a', { measured: undefined });
    v.perf!.measured.onMs('-3'); expect(a.updateNode).toHaveBeenLastCalledWith('a', { measured: undefined });
  });

  it('replica stepper clamps at 1 and 20', () => {
    const lo = nv(chain(), 'a');
    lo.v.replicas!.onDec(); expect(lo.a.updateNode).toHaveBeenLastCalledWith('a', { replicas: 1 });
    const hi = nv(behindLb({ replicas: 20 }), 'a');
    hi.v.replicas!.onInc(); expect(hi.a.updateNode).toHaveBeenLastCalledWith('a', { replicas: 20 });
  });

  it('users node has no stats, perf, sizes or replicas', () => {
    const { v } = nv(chain(), 'u');
    expect(v).toMatchObject({ stats: null, perf: null, sizes: null, replicas: null, autoscale: null });
    expect(v.tile).toBe(KINDS.users.tile);
  });

  it('custom and empty technologies', () => {
    expect(nv(chain({ tech: 'Rust' }), 'a').v.tech.options).toEqual(['Rust', ...TECHS.app]);
    const empty = nv(chain({ tech: '' }), 'a').v;
    expect(empty.tech.options).toEqual(TECHS.app);
    expect(empty.perf!.note).toBe('These are estimates; type numbers from a load test to replace them.');
  });

  it('measured numbers', () => {
    const { v, a } = nv(chain({ measured: { rps: 500, ms: 20 } }), 'a');
    expect(v.perf!.note).toMatch(/Using your measured numbers\.$/);
    expect(v.perf!.measured).toMatchObject({ rps: '500', ms: '20' });
    v.perf!.measured.onClear!(); expect(a.updateNode).toHaveBeenLastCalledWith('a', { measured: undefined });
    v.perf!.measured.onMs('30'); expect(a.updateNode).toHaveBeenLastCalledWith('a', { measured: { rps: 500, ms: 30 } });
    const msOnly = nv(chain({ measured: { ms: 5 } }), 'a').v;
    expect(msOnly.perf!.measured).toMatchObject({ rps: '', ms: '5' });
    expect(msOnly.perf!.measured.onClear).not.toBeNull();
    expect(msOnly.perf!.workers).toMatch(/ × 5\.0 ms$/);
  });

  it('health states', () => {
    expect(nv(chain(), 'a', { mut: (s) => { s.load.a = 2; } }).v.state).toEqual({ text: 'Overloaded', bad: true });
    const busy = nv(chain(), 'a', { mut: (s) => { s.load.a = 0.8; } }).v;
    expect(busy.state).toEqual({ text: 'Busy', bad: false });
    expect(busy.stats!.load.color).toBe('#e09a2c');
    expect(nv(chain(), 'a', { mut: (s) => { s.load.a = 2; } }).v.stats!.load.color).toBe('#e5484d');
    const down = nv(chain({ down: true }), 'a').v;
    expect(down.state).toEqual({ text: 'Offline', bad: true });
    expect(down.downLabel).toBe('Bring online');
    expect(down.perf!.wait).toBe('—');
    expect(down.stats!.load).toEqual({ pct: 'offline', width: 0, color: '#9a9a95' });
  });

  it('wait, workers and stats text with missing sim entries', () => {
    const w = (ms: number | undefined) => nv(chain(), 'a', { mut: (s) => { if (ms === undefined) delete s.waitMs.a; else s.waitMs.a = ms; } }).v.perf!.wait;
    expect(w(undefined)).toBe('none');
    expect(w(0.01)).toBe('none');
    expect(w(5)).toBe('5.0 ms avg');
    expect(w(25)).toBe('25 ms avg');
    const bare = nv(chain(), 'a', {
      mut: (s) => {
        delete s.service.a; delete s.workers.a; delete s.load.a; delete s.inflow.a; delete s.cap.a; delete s.nodeLatency.a; delete s.nodeCost.a;
      },
    }).v;
    expect(bare.perf!.workers).toBe('1 × 38 ms');
    expect(bare.stats).toMatchObject({ incoming: '0 rps', capacity: '0 rps', latency: '38 ms', cost: '$0' });
    expect(bare.stats!.load.pct).toBe('0%');
    expect(nv(chain(), 'a', { mut: (s) => { s.cap.a = Infinity; } }).v.stats!.capacity).toBe('∞');
  });
});

describe('nodeView: autoscale', () => {
  it('off: toggle, modes, targets', () => {
    const { v, a } = nv(chain(), 'a');
    const as = v.autoscale!;
    expect(as).toMatchObject({ on: false, horizontal: null, vertical: null, status: '' });
    expect(as.hint).toMatch(/^Adds or removes identical servers/);
    as.onToggle(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { on: true }, true);
    as.modes[1].onSelect(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { mode: 'v' }, true);
    expect(as.targets.map((t) => t.key)).toEqual(['50', '60', '70', '80']);
    as.targets[2].onSelect(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { target: 70 });
  });

  it('needs a load balancer', () => {
    const { v, a } = nv(chain({ replicas: 2 }), 'a');
    expect(v.autoscale!.status).toBe('blocked: no load balancer');
    v.needsLB!.onAdd(); expect(a.addLoadBalancer).toHaveBeenCalledWith('a');
  });

  it('horizontal: steppers and status', () => {
    const { v, a } = nv(behindLb({ autoscale: autoH(2, 10) }, 400000), 'a');
    const as = v.autoscale!;
    expect(v.replicas).toBeNull();
    expect(as.on).toBe(true);
    expect(as.status).toMatch(/^×2 · scaling out to \d+$/);
    as.horizontal!.min.onDec(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { min: 1 });
    as.horizontal!.min.onInc(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { min: 3 });
    as.horizontal!.max.onDec(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { max: 9 });
    as.horizontal!.max.onInc(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { max: 11 });
    expect(nv(behindLb({ autoscale: autoH(2, 10) }, 1000), 'a', { rt: rt({ autoRep: { a: 8 } }) }).v.autoscale!.status).toBe('×8 · scaling in to 2');
    expect(nv(behindLb({ autoscale: autoH(2, 10) }, 1000), 'a').v.autoscale!.status).toBe('×2 · steady');
    const capped = nv(behindLb({ autoscale: autoH(50, 50) }), 'a');
    capped.v.autoscale!.horizontal!.max.onInc(); expect(capped.a.updateAutoscale).toHaveBeenLastCalledWith('a', { max: 50 });
    capped.v.autoscale!.horizontal!.min.onInc(); expect(capped.a.updateAutoscale).toHaveBeenLastCalledWith('a', { min: 50 });
    capped.v.autoscale!.horizontal!.max.onDec(); expect(capped.a.updateAutoscale).toHaveBeenLastCalledWith('a', { max: 50 });
  });

  it('horizontal status without a desired count', () => {
    expect(nv(behindLb({ autoscale: autoH(2, 10) }), 'a', { mut: (s) => { delete s.desiredReps.a; } }).v.autoscale!.status).toBe('×2 · steady');
  });

  it('vertical: steppers and status', () => {
    const { v, a } = nv(chain({ autoscale: autoV(1, 4) }, 1000), 'a');
    const as = v.autoscale!;
    expect(v.sizes).toBeNull();
    expect(as.hint).toMatch(/^Resizes this one machine/);
    expect(as.vertical!.min.value).toBe('8 vCPU');
    expect(as.vertical!.max.value).toBe('192 vCPU');
    expect(as.status).toBe('8 vCPU · steady');
    as.vertical!.min.onDec(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { minSize: 0 });
    as.vertical!.min.onInc(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { minSize: 2 });
    as.vertical!.max.onDec(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { maxSize: 3 });
    as.vertical!.max.onInc(); expect(a.updateAutoscale).toHaveBeenLastCalledWith('a', { maxSize: 4 });
    expect(nv(chain({ autoscale: autoV(1, 4) }, 400000), 'a').v.autoscale!.status).toBe('8 vCPU · growing');
    expect(nv(chain({ autoscale: autoV(1, 4) }, 1000), 'a', { rt: rt({ autoSize: { a: 4 } }) }).v.autoscale!.status).toBe('192 vCPU · shrinking');
    expect(nv(chain({ autoscale: autoV(0, 0) }, 400000), 'a').v.autoscale!.status).toBe('2 vCPU · at max size');
    expect(nv(chain({ autoscale: autoV(1, 4) }), 'a', { mut: (s) => { delete s.desiredSize.a; } }).v.autoscale!.status).toBe('8 vCPU · steady');
  });
});

describe('nodeView: database', () => {
  it('defaults: no replicas, one shard, no partitions, connection limit', () => {
    const { v, a } = nv(chain(), 'd');
    const db = v.db!;
    expect(v.replicas).toBeNull();
    expect(v.sizes![0].sub).toBe('$84/mo');
    expect(db).toMatchObject({ syncModes: null, sharding: null, partition: null });
    expect(db.replicaHint).toMatch(/^No replicas/);
    expect(db.shardHint).toMatch(/^One shard holds/);
    expect(db.partitionHint).toMatch(/^Partitioning splits/);
    expect(db.conns).toMatchObject({ text: '10 needed / 100 allowed', bad: false });
    expect(db.conns!.options[0].label).toBe('100 (default)');
    expect(db.conns!.hint).toMatch(/^Each app or worker instance keeps 10/);
    db.replicas.onInc(); expect(a.updateDb).toHaveBeenLastCalledWith('d', { replicas: 1 });
    db.replicas.onDec(); expect(a.updateDb).toHaveBeenLastCalledWith('d', { replicas: 0 });
    db.shards.onInc(); expect(a.updateDb).toHaveBeenLastCalledWith('d', { shards: 2 });
    db.shards.onDec(); expect(a.updateDb).toHaveBeenLastCalledWith('d', { shards: 1 });
    db.partitions[1].onSelect(); expect(a.updateDb).toHaveBeenLastCalledWith('d', { partition: 'time' });
    db.conns!.options[1].onSelect(); expect(a.updateDb).toHaveBeenLastCalledWith('d', { maxConn: 500 });
  });

  it('replicas: async one / many, sync; steppers clamp', () => {
    const one = nv(chain({}, 12000, { dbc: { replicas: 1 } }), 'd');
    expect(one.v.db!.replicaHint).toMatch(/across 1 replica\. /);
    one.v.db!.syncModes![1].onSelect(); expect(one.a.updateDb).toHaveBeenLastCalledWith('d', { sync: true });
    expect(nv(chain({}, 12000, { dbc: { replicas: 2 } }), 'd').v.db!.replicaHint).toMatch(/across 2 replicas\. /);
    expect(nv(chain({}, 12000, { dbc: { replicas: 2, sync: true } }), 'd').v.db!.replicaHint).toMatch(/^Every write waits/);
    const max = nv(chain({}, 12000, { dbc: { replicas: 5, shards: 8, parts: 48, partition: 'hash' } }), 'd');
    max.v.db!.replicas.onInc(); expect(max.a.updateDb).toHaveBeenLastCalledWith('d', { replicas: 5 });
    max.v.db!.shards.onInc(); expect(max.a.updateDb).toHaveBeenLastCalledWith('d', { shards: 8 });
    max.v.db!.partition!.count.onInc(); expect(max.a.updateDb).toHaveBeenLastCalledWith('d', { parts: 48 });
    max.v.db!.partition!.count.onDec(); expect(max.a.updateDb).toHaveBeenLastCalledWith('d', { parts: 47 });
    const min = nv(chain({}, 12000, { dbc: { parts: 2, partition: 'list' } }), 'd');
    min.v.db!.partition!.count.onDec(); expect(min.a.updateDb).toHaveBeenLastCalledWith('d', { parts: 2 });
  });

  it('sharding strategies and keys', () => {
    const hash = nv(chain({}, 12000, { dbc: { shards: 3 } }), 'd');
    expect(hash.v.db!.shardHint).toBe('Each row goes to hash(user_id) % 3. Even spread, but range scans hit every shard. Write capacity is now ×3.');
    hash.v.db!.sharding!.onKey('tenant'); expect(hash.a.updateDb).toHaveBeenLastCalledWith('d', { shardKey: 'tenant' });
    hash.v.db!.sharding!.strategies[2].onSelect(); expect(hash.a.updateDb).toHaveBeenLastCalledWith('d', { strategy: 'geo' });
    expect(nv(chain({}, 12000, { dbc: { shards: 2, strategy: 'range', shardKey: '' } }), 'd').v.db!.shardHint).toMatch(/^Rows split by key ranges/);
    expect(nv(chain({}, 12000, { dbc: { shards: 2, strategy: 'geo' } }), 'd').v.db!.shardHint).toMatch(/^Rows live in the shard nearest/);
  });

  it('partition strategies and keys', () => {
    const time = nv(chain({}, 12000, { dbc: { partition: 'time' } }), 'd');
    expect(time.v.db!.partitionHint).toBe('One partition per period of created_at. Old months can be archived or dropped instantly. Queries that filter on created_at scan less, ~30% faster.');
    time.v.db!.partition!.onKey('day'); expect(time.a.updateDb).toHaveBeenLastCalledWith('d', { partKey: 'day' });
    expect(nv(chain({}, 12000, { dbc: { partition: 'list', partKey: '' } }), 'd').v.db!.partitionHint).toMatch(/^Rows grouped by a value of key,/);
    expect(nv(chain({}, 12000, { dbc: { partition: 'hash' } }), 'd').v.db!.partitionHint).toMatch(/^Rows spread across 12 partitions/);
  });

  it('connections: over the limit, no data, no limit, custom limit', () => {
    const over = nv(chain(), 'd', { mut: (s) => { s.dbConns.d = { need: 400, limit: 100 }; } }).v.db!.conns!;
    expect(over.bad).toBe(true);
    expect(over.hint).toMatch(/400 are needed but the servers take only 100\. .* 75% of queries fail/);
    expect(nv(chain(), 'd', { mut: (s) => { delete s.dbConns.d; delete s.dbLoad.d; } }).v.db).toMatchObject({ writeLoad: '0%', readLoad: '0%', conns: { text: '0 needed / 100 allowed' } });
    expect(nv(chain({}, 12000, { tech: 'MongoDB' }), 'd').v.db!.conns).toBeNull();
    expect(nv(chain({}, 12000, { tech: 'MongoDB', dbc: { maxConn: 500 } }), 'd').v.db!.conns!.options[0].label).toBe('100 (default)');
    expect(nv(chain({}, 12000, { down: true }), 'd').v.db!.writeLoad).toBe('offline');
  });
});

describe('nodeView: load balancer', () => {
  it('round robin across replicas: even spread', () => {
    const { v, a } = nv(behindLb({ replicas: 3 }), 'lb');
    const lb = v.lb!;
    expect(lb.hint).toBe(LB_ALGOS[0].hint);
    expect(lb.vnodes).toBeNull();
    expect(lb.empty).toBe(false);
    expect(lb.backends.map((b) => b.label)).toEqual(['App A', 'App B', 'App C']);
    expect(lb.backends[0]).toMatchObject({ share: '33%', weight: null, down: false });
    expect(lb.backends[0].rps).toMatch(/ rps$/);
    expect(lb.spread).toEqual({ text: 'Even', bad: false });
    lb.algos[2].onSelect(); expect(a.updateLb).toHaveBeenLastCalledWith('lb', { algo: 'lc' });
    expect(lb.algos[0].active).toBe(true);
  });

  it('hash: virtual nodes', () => {
    const d = behindLb({ replicas: 3 });
    d.nodes[1].lbc = { algo: 'hash' };
    const { v, a } = nv(d, 'lb');
    expect(v.lb!.vnodes!.find((o) => o.active)!.key).toBe('10');
    v.lb!.vnodes![2].onSelect(); expect(a.updateLb).toHaveBeenLastCalledWith('lb', { vnodes: 100 });
  });

  it('weighted: weight steppers on the first replica, uneven spread', () => {
    const d = blankDoc({
      nodes: [N('u', 'users', 0, 0, 'U'), N('lb', 'lb', 300, 0, 'LB', { lbc: { algo: 'wrr' } }), N('a', 'app', 600, 0, 'A', { replicas: 2 }), N('b', 'app', 600, 300, 'B')],
      edges: [E('ul', 'u', 'lb'), E('la', 'lb', 'a', { weight: 10 }), E('lbb', 'lb', 'b', { weight: 0 })],
    });
    const { v, a } = nv(d, 'lb');
    const [a0, a1, b0] = v.lb!.backends;
    expect(a0.weight!.value).toBe(10);
    expect(a1.weight).toBeNull();
    expect(b0.weight!.value).toBe(1);
    a0.weight!.onInc(); expect(a.updateEdge).toHaveBeenLastCalledWith('la', { weight: 10 });
    a0.weight!.onDec(); expect(a.updateEdge).toHaveBeenLastCalledWith('la', { weight: 9 });
    b0.weight!.onDec(); expect(a.updateEdge).toHaveBeenLastCalledWith('lbb', { weight: 1 });
    b0.weight!.onInc(); expect(a.updateEdge).toHaveBeenLastCalledWith('lbb', { weight: 2 });
    expect(v.lb!.spread).toEqual({ text: 'Busiest is 10.0× the quietest', bad: false });
    const hot = nv(d, 'lb', { mut: (s) => { s.repLoad.a = [3, 3]; s.repLoad.b = [1]; } }).v;
    expect(hot.lb!.spread).toEqual({ text: 'Busiest is 3.0× the quietest', bad: true });
  });

  it('one server gets nothing; idle; single backend; empty; down backend', () => {
    const inf = blankDoc({
      nodes: [N('u', 'users', 0, 0, 'U'), N('lb', 'lb', 300, 0, 'LB'), N('a', 'app', 600, 0, 'A'), N('u2', 'users', 600, 300, 'Sink')],
      edges: [E('ul', 'u', 'lb'), E('la', 'lb', 'a'), E('lu', 'lb', 'u2')],
    });
    expect(nv(inf, 'lb').v.lb!.spread).toEqual({ text: 'One server gets nothing', bad: false });
    expect(nv(behindLb({ replicas: 2 }, 0), 'lb').v.lb!.spread).toEqual({ text: 'Idle', bad: false });
    expect(nv(behindLb(), 'lb').v.lb!.spread.text).toBe('One backend: nothing to balance');
    const empty = blankDoc({ nodes: [N('lb', 'lb', 0, 0, 'LB')] });
    expect(nv(empty, 'lb').v.lb).toMatchObject({ empty: true, backends: [] });
    const down = nv(behindLb({ down: true }), 'lb').v.lb!;
    expect(down.backends[0]).toMatchObject({ share: '—', down: true, load: { pct: 'offline' } });
    expect(down.spread.text).toBe('One backend: nothing to balance');
  });

  it('many replicas run out of letters; unknown algorithm; missing sim data', () => {
    const many = nv(behindLb({ replicas: 28 }), 'lb').v.lb!;
    expect(many.backends[26].label).toBe('App 27');
    const odd = behindLb();
    odd.nodes[1].lbc = { algo: 'zzz' as never };
    expect(nv(odd, 'lb').v.lb!.hint).toBe('');
    const bare = nv(behindLb({ replicas: 2 }), 'lb', { mut: (s) => { delete s.repLoad.a; delete s.reps.a; } }).v.lb!;
    expect(bare.backends.map((b) => b.label)).toEqual(['App', 'App']);
    expect(bare.backends[0].load.pct).toBe('0%');
    expect(nv(behindLb(), 'lb', { mut: (s) => { delete s.lbBackends.lb; } }).v.lb!.empty).toBe(true);
    const lost = nv(behindLb(), 'lb', { mut: (s) => { s.lbBackends.lb = [{ ...s.lbBackends.lb[0], edgeId: 'gone' }]; } }).v.lb!;
    expect(lost.backends[0].weight).toBeNull();
  });
});

describe('nodeView: cache', () => {
  const lone = (over: Partial<DesignNode> = {}) => blankDoc({
    nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A'), N('c', 'cache', 600, 0, 'C', over)],
    edges: [E('ua', 'u', 'a'), E('ac', 'a', 'c')],
  });
  const backed = (dbDown = false, over: Partial<DesignNode> = {}) => blankDoc({
    nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A'), N('c', 'cache', 600, 0, 'C', over), N('d', 'db', 900, 0, 'D', { down: dbDown })],
    edges: [E('ua', 'u', 'a'), E('ac', 'a', 'c'), E('cd', 'c', 'd')],
  });

  it('nothing behind it', () => {
    const { v, a } = nv(lone(), 'c');
    expect(v.cache).toMatchObject({ hit: '90% of reads', state: { text: 'Warm', bad: false } });
    expect(v.cache!.hint).toMatch(/^Nothing is behind this cache/);
    expect(v.sizes![0].sub).toBe('$36/mo');
    v.cache!.ttl[4].onSelect(); expect(a.updateCache).toHaveBeenLastCalledWith('c', { ttl: 3600 });
  });

  it('backed by a database: ttl text in minutes, hours, seconds', () => {
    expect(nv(backed(), 'c').v.cache!.hint).toMatch(/^90% of reads are answered from memory.*Keys live 1 min:/);
    expect(nv(backed(false, { cachec: { ttl: 3600 } }), 'c').v.cache!.hint).toMatch(/Keys live 1 h:/);
    expect(nv(backed(false, { cachec: { ttl: 30 } }), 'c').v.cache!.hint).toMatch(/Keys live 30 s:/);
  });

  it('database offline: expiring, then empty', () => {
    const exp = nv(backed(true), 'c').v.cache!;
    expect(exp.state).toEqual({ text: 'DB offline · empty in ~60s', bad: true });
    expect(exp.hint).toMatch(/^The database behind it is offline/);
    expect(nv(backed(true), 'c', { rt: rt({ cacheHit: { c: 0 } }) }).v.cache!.state).toEqual({ text: 'DB offline · empty', bad: true });
  });

  it('warming up, offline, missing hit data', () => {
    const warm = nv(backed(), 'c', { rt: rt({ cacheHit: { c: 0.5 } }) }).v.cache!;
    expect(warm.state).toEqual({ text: 'Warming up', bad: false });
    expect(warm.hint).toMatch(/^The cache started empty/);
    const down = nv(backed(false, { down: true }), 'c').v.cache!;
    expect(down).toMatchObject({ hit: '—', state: { text: 'Offline · contents lost', bad: true } });
    expect(down.hint).toMatch(/^Memory is lost/);
    expect(nv(backed(), 'c', { mut: (s) => { delete s.cacheHit.c; } }).v.cache!.hit).toBe('90% of reads');
  });
});

describe('nodeView: queue', () => {
  const q = (users = 12000, consumer = true, over: Partial<DesignNode> = {}) => blankDoc({
    users,
    nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A'), N('q', 'queue', 600, 0, 'Q', over), N('w', 'worker', 900, 0, 'W')],
    edges: [E('ua', 'u', 'a'), E('aq', 'a', 'q', { mode: 'async' }), ...(consumer ? [E('qw', 'q', 'w')] : [])],
  });

  it('keeping up', () => {
    const { v } = nv(q(1000), 'q');
    expect(v.queue).toMatchObject({ waiting: '0 messages', trend: { text: 'Empty', bad: false }, onPurge: null, max: '1.0M' });
    expect(v.queue!.fill).toEqual({ pct: '0% full', width: 0, color: '#4f86c9' });
    expect(v.queue!.drainCap).toMatch(/ msg\/s$/);
    expect(v.queue!.hint).toMatch(/^Consumers keep up/);
    expect(v.perf!.workers).toBe('—');
    expect(v.stats!.latency).toBe('async');
  });

  it('no consumer', () => {
    const v = nv(q(1000, false), 'q').v.queue!;
    expect(v.drainCap).toBe('no consumer');
    expect(v.hint).toMatch(/^Nothing reads this queue/);
    expect(v.trend.text).toMatch(/^Growing \+/);
    expect(v.fill.color).toBe('#e09a2c');
  });

  it('growing behind a slow consumer', () => {
    const v = nv(q(12000), 'q', { rt: rt({ qDepth: { q: 1000 } }) }).v.queue!;
    expect(v.trend).toMatchObject({ bad: true });
    expect(v.trend.text).toMatch(/^Growing \+/);
    expect(v.fill.color).toBe('#e09a2c');
    expect(v.hint).toMatch(/^Producers are faster/);
  });

  it('full, then purge', () => {
    const { v, a } = nv(q(), 'q', { rt: rt({ qDepth: { q: QUEUE_MAX } }) });
    expect(v.queue!.trend).toEqual({ text: 'Full · rejecting new messages', bad: true });
    expect(v.queue!.fill).toMatchObject({ pct: '100% full', width: 100, color: '#e5484d' });
    expect(v.queue!.hint).toMatch(/^The queue hit its limit/);
    v.queue!.onPurge!(); expect(a.purgeQueue).toHaveBeenCalledWith('q');
  });

  it('draining a backlog', () => {
    const v = nv(q(100), 'q', { rt: rt({ qDepth: { q: 1000 } }) }).v.queue!;
    expect(v.trend.text).toMatch(/^Draining · empty in ~\d+s$/);
    expect(v.fill.color).toBe('#3f9b6b');
    expect(v.hint).toMatch(/^Consumers are faster than producers/);
  });

  it('steady backlog, unlimited consumers, offline, no stats', () => {
    const steady = nv(q(), 'q', { mut: (s) => { s.queue.q = { ...s.queue.q, depth: 50, growth: 0, drainCap: Infinity }; } }).v.queue!;
    expect(steady.trend.text).toBe('Steady');
    expect(steady.drainCap).toBe('∞');
    expect(nv(q(1000, true, { down: true }), 'q').v.queue!.trend).toEqual({ text: 'offline', bad: true });
    const none = nv(q(), 'q', { mut: (s) => { delete s.queue.q; } }).v.queue!;
    expect(none).toMatchObject({ waiting: '0 messages', inRate: '0 msg/s', outRate: '0 msg/s', drainCap: '0 msg/s', trend: { text: 'Empty' } });
  });
});

/* ------------------------------------------------------------------ */

describe('edgeView', () => {
  const doc = () => blankDoc({
    nodes: [
      N('u', 'users', 0, 0, 'Users'), N('gw', 'gateway', 300, 0, 'GW'), N('a', 'app', 600, 0, 'Server'), N('b', 'app', 600, 300, 'Server'),
      N('lb', 'lb', 900, 0, 'LB'), N('c', 'app', 1200, 0, 'C'), N('q', 'queue', 900, 300, 'Q'), N('w', 'worker', 1200, 300, 'W'),
    ],
    edges: [
      E('ug', 'u', 'gw'), E('ga', 'gw', 'a', { route: '/a', weight: 3 }), E('gb', 'gw', 'b'), E('gfan', 'gw', 'c', { calls: 1 }),
      E('alb', 'a', 'lb'), E('lc', 'lb', 'c'), E('lghost', 'lb', 'zzz'), E('aq', 'a', 'q', { mode: 'async' }), E('qw', 'q', 'w'),
    ],
  });

  it('gateway route, weight share, ends with duplicate labels', () => {
    const { v, a } = ev(doc(), 'ga');
    expect(v.title).toBe('GW → Server');
    expect(v.route!.value).toBe('/a');
    v.route!.onChange('/b'); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { route: '/b' });
    expect(v.share).toBe('75% of GW');
    expect(v.weightNote).toBeNull();
    const opts = v.ends.to.options;
    expect(opts.find((o) => o.value === 'a')!.label).toBe('Server (App Server)');
    expect(opts.find((o) => o.value === 'u')!.label).toBe('Users');
    expect(opts.find((o) => o.value === 'a')!.disabled).toBe(false);
    expect(opts.find((o) => o.value === 'gw')!.disabled).toBe(true);
    expect(opts.find((o) => o.value === 'b')!.disabled).toBe(true); // gw→b exists
    v.ends.from.onChange('u'); expect(a.rewireEdge).toHaveBeenLastCalledWith('ga', 'from', 'u');
    v.modes[1].onSelect(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { mode: 'async' });
    v.protocols[1].onSelect(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { proto: 'gRPC' });
    v.ops[0].onSelect(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { op: 'read' });
    v.weight.onInc(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { weight: 4 });
    v.weight.onDec(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { weight: 2 });
    v.calls![0].onSelect(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { calls: undefined });
    v.calls![3].onSelect(); expect(a.updateEdge).toHaveBeenLastCalledWith('ga', { calls: 3 });
    v.onReverse(); expect(a.reverseEdge).toHaveBeenCalledWith('ga');
    v.onDelete(); expect(a.deleteEdge).toHaveBeenCalledWith('ga');
    expect(v.rps).toMatch(/ rps$/);
  });

  it('weight steppers clamp; zero weight counts as 1', () => {
    const d = doc();
    d.edges[2].weight = 0;
    const { v, a } = ev(d, 'gb');
    expect(v.weight.value).toBe(1);
    v.weight.onDec(); expect(a.updateEdge).toHaveBeenLastCalledWith('gb', { weight: 1 });
    d.edges[2].weight = 10;
    const hi = ev(d, 'gb');
    hi.v.weight.onInc(); expect(hi.a.updateEdge).toHaveBeenLastCalledWith('gb', { weight: 10 });
  });

  it('fan-out: one call and many calls', () => {
    const one = ev(doc(), 'gfan').v;
    expect(one.weightNote).toBe('Weight is ignored: every request makes 1 call here.');
    expect(one.share).toBe('1× every request');
    const d = doc();
    d.edges[3].calls = 5;
    expect(ev(d, 'gfan').v.weightNote).toBe('Weight is ignored: every request makes 5 calls here.');
  });

  it('only fan-out connections: weights sum falls back to 1', () => {
    const d = blankDoc({
      nodes: [N('a', 'app', 0, 0, 'A'), N('b', 'app', 300, 0, 'B')],
      edges: [E('ab', 'a', 'b', { calls: 2 })],
    });
    expect(ev(d, 'ab').v.share).toBe('2× every request');
  });

  it('load balancer and queue sources have no calls / resilience', () => {
    const lb = ev(doc(), 'lc').v;
    expect(lb.calls).toBeNull();
    expect(lb.resilience).toBeNull();
    expect(lb.weightNote).toBe('Weight is only used when LB runs Weighted round robin. Its algorithm decides the split.');
    expect(lb.share).toBe('100% of LB');
    const d = doc();
    d.nodes[4].lbc = { algo: 'wrr' };
    expect(ev(d, 'lc').v.weightNote).toBeNull();
    d.users = 0;
    expect(ev(d, 'lc').v.share).toBe('0% of LB');
    expect(ev(doc(), 'lc', { mut: (s) => { delete s.edgeRps.lc; } }).v.share).toBe('0% of LB');
    const qv = ev(doc(), 'qw').v;
    expect(qv.calls).toBeNull();
    expect(qv.resilience).toBeNull();
  });

  it('resilience: calm, retries, breaker', () => {
    const calm = ev(doc(), 'ga');
    const r = calm.v.resilience!;
    expect(r).toMatchObject({ state: 'Calm', bad: false, breaker: { on: false } });
    expect(r.hint).toMatch(/^Retries hide short blips/);
    expect(r.retries.map((o) => o.label)).toEqual(['None', '1', '2', '3']);
    r.retries[0].onSelect(); expect(calm.a.updateEdge).toHaveBeenLastCalledWith('ga', { retries: undefined });
    r.retries[2].onSelect(); expect(calm.a.updateEdge).toHaveBeenLastCalledWith('ga', { retries: 2 });
    r.breaker.onToggle(); expect(calm.a.updateEdge).toHaveBeenLastCalledWith('ga', { breaker: true });
    const d = doc();
    d.edges[1].breaker = true;
    d.edges[1].retries = 2;
    const on = ev(d, 'ga', { mut: (s) => { s.retryAmp.ga = 1.1; } });
    expect(on.v.resilience).toMatchObject({ state: 'Retries ×1.1 load', bad: false, breaker: { on: true } });
    expect(on.v.resilience!.hint).toMatch(/^Server is dropping requests/);
    on.v.resilience!.breaker.onToggle(); expect(on.a.updateEdge).toHaveBeenLastCalledWith('ga', { breaker: undefined });
    expect(ev(d, 'ga', { mut: (s) => { s.retryAmp.ga = 2; } }).v.resilience!.bad).toBe(true);
    const open = ev(d, 'ga', { mut: (s) => { s.breakerOpen.ga = true; } }).v.resilience!;
    expect(open).toMatchObject({ state: 'Breaker open · failing fast', bad: true });
    expect(open.hint).toMatch(/^Server kept failing/);
  });

  it('slow path and async', () => {
    expect(ev(doc(), 'aq').v.onSlowPath).toBe('No (async)');
    expect(ev(doc(), 'ga', { mut: (s) => { s.onSlowPath.ga = true; } }).v.onSlowPath).toBe('Yes, slowest path');
    expect(ev(doc(), 'ga', { mut: (s) => { s.onSlowPath.ga = false; delete s.edgeRps.ga; } }).v).toMatchObject({ onSlowPath: 'No', rps: '0 rps' });
  });
});
