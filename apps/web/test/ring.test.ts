import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DesignDoc, DesignNode } from '@syslab/types';
import { DOWN_COLORS, HOT_COLORS, KINDS, RING_MAX_SHOWN, blankDoc, makeEdge, makeNode, simulate, type SimResult } from '@syslab/sim';
import { buildCanvasView, RING_NODE_SCALE, type CanvasUi } from '@/lib/canvas/buildCanvasView';
import type { EditorActions } from '@/hooks/editor/editor.store';
import { nodeView } from '@/hooks/editor/useInspector';

const N = makeNode, E = makeEdge;
const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};

/** users → app → Cassandra */
const doc = (dbc: Record<string, unknown> = {}, over: Partial<DesignNode> = {}, users = 12000, read?: number): DesignDoc => {
  const d = blankDoc({
    users,
    nodes: [N('u', 'users', -400, 0, 'U'), N('a', 'app', 0, 0, 'A', { size: 4 }), N('d', 'db', 400, 0, 'Msgs', { tech: 'Cassandra', dbc, ...over })],
    edges: [E('ua', 'u', 'a'), E('ad', 'a', 'd')],
  });
  if (read != null) d.requirements = { ...d.requirements!, read };
  return d;
};
const build = (d: DesignDoc, ui: Partial<CanvasUi> = {}, mut?: (s: SimResult) => void) => {
  const sim = simulate(d);
  mut?.(sim);
  return buildCanvasView(d, sim, { ...UI, ...ui });
};
const ringNode = (v: ReturnType<typeof build>) => v.nodes.find((n) => n.id === 'd')!;

describe('ring database on the canvas', () => {
  it('draws its nodes around it with a label of the ring', () => {
    const n = ringNode(build(doc({ nodes: 6 })));
    expect(n.extras).toHaveLength(6);
    expect(n.extras.every((x) => x.scale === RING_NODE_SCALE && x.label === '' && x.shape === 'db')).toBe(true);
    // the first node sits straight above the anchor
    expect(n.extras[0]).toMatchObject({ dx: 0, dy: -120 });
    expect(n.below?.text).toBe('Msgs · ring of 6 · RF 3 · QUORUM');
    expect(n.warn).toBeNull();
    expect(n.extras[0].below).toBeNull();
    // different read and write levels are both named
    expect(ringNode(build(doc({ nodes: 6, consistency: 'one', writeConsistency: 'all' }))).below?.text).toBe('Msgs · ring of 6 · RF 3 · R ONE / W ALL');
  });

  it('gossip: neighbours always, chords from six nodes, packets only while live', () => {
    const g = (d: DesignDoc, ui: Partial<CanvasUi> = {}) => build(d, ui).replication.filter((l) => l.gossip);
    expect(g(doc({ nodes: 4 }))).toHaveLength(4);
    const six = g(doc({ nodes: 6 }));
    expect(six).toHaveLength(9); // 6 neighbours + 3 chords
    expect(six.every((l) => !l.sync && l.packets.length === 1)).toBe(true);
    expect(six[0].packets[0].dur).toBe('3.20');
    expect(g(doc({ nodes: 6 }), { running: false })[0].packets).toEqual([]);
    expect(g(doc({ nodes: 6 }, { down: true }))[0].packets).toEqual([]);
  });

  it('a big ring shows at most RING_MAX_SHOWN nodes and says how many more', () => {
    const n = ringNode(build(doc({ nodes: 20 })));
    expect(n.extras).toHaveLength(RING_MAX_SHOWN);
    expect(n.extras[0].below).toEqual({ text: `+${20 - RING_MAX_SHOWN} more nodes`, info: true });
  });

  it('failed nodes are greyed, with a warning when requests lose their consistency level', () => {
    const one = ringNode(build(doc({ nodes: 6, downNodes: 1 })));
    expect(one.extras[0].colors).toEqual(DOWN_COLORS);
    expect(one.extras[1].colors).not.toEqual(DOWN_COLORS);
    expect(one.warn).toBe('1 of 6 nodes down · still QUORUM');
    const two = ringNode(build(doc({ nodes: 6, downNodes: 2 })));
    expect(two.warn).toBe('2 of 6 nodes down · 20% of requests below QUORUM');
    // tiny but non-zero shares still read as at least 1%
    expect(ringNode(build(doc({ nodes: 6, downNodes: 2 }), {}, (s) => { s.ring.d.unavailable = 0.001; })).warn).toBe('2 of 6 nodes down · 1% of requests below QUORUM');
    // the whole database offline: every node grey, no ring warning
    const off = ringNode(build(doc({ nodes: 6, downNodes: 2 }, { down: true })));
    expect(off.extras.every((x) => x.colors === DOWN_COLORS)).toBe(true);
    expect(off.warn).toBe('node offline');
  });

  it('a hot partition reddens its replicas only', () => {
    const n = ringNode(build(doc({ nodes: 12, hotShare: 60 }, {}, 1_500_000)));
    const hot = n.extras.slice(0, 3), cold = n.extras.slice(3);
    expect(hot.every((x) => x.colors === HOT_COLORS)).toBe(true);
    expect(cold.every((x) => x.colors === KINDS.db.colors)).toBe(true);
    expect(n.warn).toMatch(/^hot partition · 3 of 12 nodes at \d+%, the rest \d+%$/);
    // the replicas come after the failed nodes
    const withDown = ringNode(build(doc({ nodes: 12, hotShare: 60, downNodes: 1 }, {}, 1_500_000)));
    expect(withDown.extras[0].colors).toBe(DOWN_COLORS);
    expect(withDown.extras[1].colors).toBe(HOT_COLORS);
    expect(withDown.warn).toMatch(/nodes down/);
    // a mild skew is not worth a warning; bucketing evens it out
    expect(ringNode(build(doc({ nodes: 12, hotShare: 10 }))).warn).toBeNull();
    expect(ringNode(build(doc({ nodes: 12, hotShare: 60, buckets: 4 }))).warn).toBeNull();
  });

  it('wide partitions and stale reads are called out', () => {
    expect(ringNode(build(doc({ nodes: 6, partitionMb: 500 }))).warn).toBe('wide partitions · 500 MB (keep under 100 MB)');
    // bucketing splits the partition too
    expect(ringNode(build(doc({ nodes: 6, partitionMb: 500, buckets: 8 }))).warn).toBeNull();
    expect(ringNode(build(doc({ nodes: 6, consistency: 'one', writeConsistency: 'one' }))).warn).toBe('R + W ≤ RF · up to 67% of fresh reads stale');
  });

  it('falls back to the node config when the engine did not report the ring', () => {
    const n = ringNode(build(doc({ nodes: 5 }), {}, (s) => { delete s.ring.d; }));
    expect(n.below?.text).toBe('Msgs · ring of 5 · RF 3 · QUORUM');
  });
});

/* ------------------------------------------------------------------ */

type Actions = EditorActions & Record<string, Mock>;
const mockActions = (): Actions => {
  const fns: Record<string, Mock> = {};
  return new Proxy(fns, { get: (t, k: string) => (t[k] ??= vi.fn()) }) as unknown as Actions;
};
const inspect = (d: DesignDoc, mut?: (s: SimResult) => void) => {
  const sim = simulate(d);
  mut?.(sim);
  const a = mockActions();
  return { ring: nodeView(d.nodes.find((n) => n.id === 'd')!, d, sim, a).db!.ring!, a };
};

describe('ring cluster card', () => {
  it('only for ring databases', () => {
    const d = doc();
    d.nodes[2].tech = 'Postgres';
    const sim = simulate(d);
    expect(nodeView(d.nodes[2], d, sim, mockActions()).db!.ring).toBeNull();
  });

  it('steppers change the ring within its limits', () => {
    const { ring, a } = inspect(doc({ nodes: 6, downNodes: 2 }));
    expect(ring.nodes.value).toBe(6);
    ring.nodes.onInc(); ring.nodes.onDec();
    expect(a.updateDb).toHaveBeenNthCalledWith(1, 'd', { nodes: 7 });
    expect(a.updateDb).toHaveBeenNthCalledWith(2, 'd', { nodes: 5, downNodes: 2 });
    ring.rf.onInc(); ring.rf.onDec();
    expect(a.updateDb).toHaveBeenNthCalledWith(3, 'd', { rf: 4 });
    expect(a.updateDb).toHaveBeenNthCalledWith(4, 'd', { rf: 2 });
    ring.down.onInc(); ring.down.onDec();
    expect(a.updateDb).toHaveBeenNthCalledWith(5, 'd', { downNodes: 3 });
    expect(a.updateDb).toHaveBeenNthCalledWith(6, 'd', { downNodes: 1 });
    expect(ring.readCl.map((o) => o.label)).toEqual(['ONE', 'QUORUM', 'ALL']);
    expect(ring.readCl.find((o) => o.active)!.label).toBe('QUORUM');
    ring.readCl[2].onSelect();
    expect(a.updateDb).toHaveBeenLastCalledWith('d', { consistency: 'all' });
    ring.writeCl[0].onSelect();
    expect(a.updateDb).toHaveBeenLastCalledWith('d', { writeConsistency: 'one' });
  });

  it('load steppers: hot share by 10%, buckets doubling, partition size on a ladder', () => {
    const { ring, a } = inspect(doc({ hotShare: 30, buckets: 4, partitionMb: 100 }));
    expect([ring.hotShare.value, ring.buckets.value, ring.partitionMb.value]).toEqual(['30%', 4, '100 MB']);
    ring.hotShare.onInc(); ring.hotShare.onDec();
    ring.buckets.onInc(); ring.buckets.onDec();
    ring.partitionMb.onInc(); ring.partitionMb.onDec();
    ring.specRetry.onToggle();
    expect(a.updateDb.mock.calls.map((c) => c[1])).toEqual([
      { hotShare: 40 }, { hotShare: 20 }, { buckets: 8 }, { buckets: 2 }, { partitionMb: 200 }, { partitionMb: 50 }, { specRetry: false },
    ]);
    expect(ring.specRetry.on).toBe(true);
  });

  it('steppers stop at the edges', () => {
    const { ring, a } = inspect(doc({ nodes: 3, rf: 1, downNodes: 3, hotShare: 0, buckets: 1, partitionMb: 1 }));
    ring.nodes.onDec(); ring.rf.onDec(); ring.down.onInc(); ring.hotShare.onDec(); ring.buckets.onDec(); ring.partitionMb.onDec();
    expect(a.updateDb.mock.calls.map((c) => c[1])).toEqual([{ nodes: 3, downNodes: 2 }, { rf: 1 }, { downNodes: 3 }, { hotShare: 0 }, { buckets: 1 }, { partitionMb: 1 }]);
    const big = inspect(doc({ nodes: 24, rf: 3, hotShare: 90, buckets: 64, partitionMb: 2000 }));
    big.ring.nodes.onInc(); big.ring.down.onDec(); big.ring.hotShare.onInc(); big.ring.buckets.onInc(); big.ring.partitionMb.onInc();
    expect(big.a.updateDb.mock.calls.map((c) => c[1])).toEqual([{ nodes: 24 }, { downNodes: 0 }, { hotShare: 90 }, { buckets: 64 }, { partitionMb: 2000 }]);
  });

  it('status and hint follow the failed nodes and consistency', () => {
    const healthy = inspect(doc({ nodes: 6 })).ring;
    expect(healthy.status).toEqual({ text: 'survives 1 node down', bad: false });
    expect(healthy.consistency).toEqual({ text: 'R 2 + W 2 > RF 3 · consistent', bad: false });
    expect(healthy.hint).toMatch(/^Every row lives on 3 of the 6 nodes\. Reads wait for 2 \(QUORUM\), writes for 2 \(QUORUM\)/);
    expect(healthy.hint).toContain('R + W > RF, so every read overlaps the latest write. Up to 1 node can fail');
    const stale = inspect(doc({ nodes: 6, consistency: 'one', writeConsistency: 'one' })).ring;
    expect(stale.consistency).toEqual({ text: 'R 1 + W 1 ≤ RF 3 · up to 67% stale', bad: true });
    expect(stale.status.text).toBe('survives 2 nodes down');
    expect(stale.hint).toContain('a read right after a write can miss it (up to 67%)');
    expect(inspect(doc({ nodes: 6, consistency: 'all' })).ring.status).toEqual({ text: 'no node may fail', bad: false });
    const one = inspect(doc({ nodes: 6, downNodes: 1 })).ring;
    expect(one.status.bad).toBe(false);
    expect(one.hint).toContain('1 node is down now, and every row still has enough live replicas.');
    const two = inspect(doc({ nodes: 6, downNodes: 2 })).ring;
    expect(two.status).toEqual({ text: '20% of requests unavailable', bad: true });
    expect(two.hint).toContain('2 nodes are down now: requests whose replicas include too many failed nodes fail at once (UnavailableException).');
    expect(two.errors[0]).toMatchObject({ label: 'UnavailableException', bad: true });
    expect(inspect(doc({ nodes: 6, downNodes: 2 }), (s) => { s.ring.d.unavailable = 0.001; }).ring.status.text).toBe('1% of requests unavailable');
    // without the engine's ring the config is used
    expect(inspect(doc({ nodes: 6 }), (s) => { delete s.ring.d; }).ring.nodes.value).toBe(6);
  });

  it('tpstats and timeouts of the busiest node', () => {
    const calm = inspect(doc({ nodes: 6 })).ring;
    expect(calm.stages.map((s) => s.name)).toEqual(['ReadStage', 'MutationStage']);
    expect(calm.stages.every((s) => !s.bad && s.dropped === '0/s')).toBe(true);
    expect(calm.errors[1]).toMatchObject({ label: 'Read / WriteTimeout', value: '0/s · 0/s', bad: false });
    const hot = inspect(doc({ nodes: 12, hotShare: 60 }, {}, 1_500_000)).ring;
    expect(hot.stages[0].bad).toBe(true);
    expect(hot.stages[0].dropped).not.toBe('0/s');
    expect(Number(hot.stages[0].pending.replace(/,/g, ''))).toBeGreaterThan(0);
    expect(hot.errors[1].bad).toBe(true);
    // the read ratio splits the timeouts
    expect(inspect(doc({ nodes: 12, hotShare: 60 }, {}, 1_500_000, 50)).ring.errors[1].value).toMatch(/^(.+)\/s · \1\/s$/);
    // no traffic and no wait recorded
    expect(inspect(doc({ nodes: 6 }, {}, 0), (s) => { delete s.waitMs.d; delete s.inflow.d; }).ring.stages[0].pending).toBe('0');
  });

  it('load hint covers skew, wide partitions and speculative retry', () => {
    expect(inspect(doc({ nodes: 6 })).ring.loadHint).toMatch(/^Traffic is spread evenly over the ring\. Speculative retry \(99p\)/);
    const hot = inspect(doc({ nodes: 12, hotShare: 30 })).ring.loadHint;
    expect(hot).toMatch(/^30% of traffic hits one partition key, so its 3 replica nodes run at \d+% while the other 9 run at \d+%\. Salt the key/);
    expect(inspect(doc({ nodes: 12, hotShare: 30, buckets: 2 })).ring.loadHint).toContain('Salting it into 2 buckets spreads it over more nodes.');
    expect(inspect(doc({ nodes: 6, hotShare: 30, buckets: 2 })).ring.loadHint).toContain('its 6 replica nodes cover the whole ring.');
    expect(inspect(doc({ nodes: 3, rf: 1, hotShare: 30, downNodes: 2 })).ring.loadHint).toContain('its 1 replica node cover the whole ring.');
    expect(inspect(doc({ nodes: 6, partitionMb: 500 })).ring.loadHint).toContain('Partitions of 500 MB make each read 3.0× dearer');
    const off = inspect(doc({ nodes: 6, specRetry: false })).ring.loadHint;
    expect(off).toContain('Without speculative retry, one slow replica sets the P99.');
    expect(off).toMatch(/time out after 5 s \(reads\) or 2 s \(writes\)\.$/);
  });
});
