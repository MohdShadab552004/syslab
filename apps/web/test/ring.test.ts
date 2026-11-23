import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DesignDoc, DesignNode } from '@syslab/types';
import { DOWN_COLORS, RING_MAX_SHOWN, blankDoc, makeEdge, makeNode, simulate, type SimResult } from '@syslab/sim';
import { buildCanvasView, RING_NODE_SCALE, type CanvasUi } from '@/lib/canvas/buildCanvasView';
import type { EditorActions } from '@/hooks/editor/editor.store';
import { nodeView } from '@/hooks/editor/useInspector';

const N = makeNode, E = makeEdge;
const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};

/** users → app → Cassandra */
const doc = (dbc: Record<string, unknown> = {}, over: Partial<DesignNode> = {}, users = 12000): DesignDoc => blankDoc({
  users,
  nodes: [N('u', 'users', -400, 0, 'U'), N('a', 'app', 0, 0, 'A', { size: 4 }), N('d', 'db', 400, 0, 'Msgs', { tech: 'Cassandra', dbc, ...over })],
  edges: [E('ua', 'u', 'a'), E('ad', 'a', 'd')],
});
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

  it('failed nodes are greyed, with a warning when rows lose their consistency level', () => {
    const one = ringNode(build(doc({ nodes: 6, downNodes: 1 })));
    expect(one.extras[0].colors).toEqual(DOWN_COLORS);
    expect(one.extras[1].colors).not.toEqual(DOWN_COLORS);
    expect(one.warn).toBe('1 of 6 nodes down · still QUORUM');
    const two = ringNode(build(doc({ nodes: 6, downNodes: 2 })));
    expect(two.warn).toBe('2 of 6 nodes down · 20% of rows below QUORUM');
    // tiny but non-zero shares still read as at least 1%
    expect(ringNode(build(doc({ nodes: 6, downNodes: 2 }), {}, (s) => { s.ring.d.unavailable = 0.001; })).warn).toBe('2 of 6 nodes down · 1% of rows below QUORUM');
    // the whole database offline: every node grey, no ring warning
    const off = ringNode(build(doc({ nodes: 6, downNodes: 2 }, { down: true })));
    expect(off.extras.every((x) => x.colors === DOWN_COLORS)).toBe(true);
    expect(off.warn).not.toMatch(/nodes down/);
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
    expect(ring.consistency.map((o) => o.label)).toEqual(['ONE', 'QUORUM', 'ALL']);
    expect(ring.consistency.find((o) => o.active)!.label).toBe('QUORUM');
    ring.consistency[2].onSelect();
    expect(a.updateDb).toHaveBeenLastCalledWith('d', { consistency: 'all' });
  });

  it('steppers stop at the edges', () => {
    const { ring, a } = inspect(doc({ nodes: 3, rf: 1, downNodes: 3 }));
    ring.nodes.onDec(); ring.rf.onDec(); ring.down.onInc();
    expect(a.updateDb.mock.calls.map((c) => c[1])).toEqual([{ nodes: 3, downNodes: 2 }, { rf: 1 }, { downNodes: 3 }]);
    const big = inspect(doc({ nodes: 24, rf: 3 }));
    big.ring.nodes.onInc(); big.ring.down.onDec();
    expect(big.a.updateDb.mock.calls.map((c) => c[1])).toEqual([{ nodes: 24 }, { downNodes: 0 }]);
  });

  it('status and hint follow the failed nodes', () => {
    const healthy = inspect(doc({ nodes: 6 })).ring;
    expect(healthy.status).toEqual({ text: 'survives 1 node down', bad: false });
    expect(healthy.hint).toMatch(/^Every row lives on 3 of the 6 nodes .* up to 1 node can fail/);
    expect(inspect(doc({ nodes: 6, consistency: 'one' })).ring.status.text).toBe('survives 2 nodes down');
    expect(inspect(doc({ nodes: 6, consistency: 'all' })).ring.status).toEqual({ text: 'no node may fail', bad: false });
    const one = inspect(doc({ nodes: 6, downNodes: 1 })).ring;
    expect(one.status.bad).toBe(false);
    expect(one.hint).toContain('1 node is down now, and every row still has enough live replicas.');
    const two = inspect(doc({ nodes: 6, downNodes: 2 })).ring;
    expect(two.status).toEqual({ text: '20% of rows unavailable', bad: true });
    expect(two.hint).toContain("2 nodes are down now: rows whose replicas include too many failed nodes can't reach QUORUM and fail.");
    expect(inspect(doc({ nodes: 6, downNodes: 2 }), (s) => { s.ring.d.unavailable = 0.001; }).ring.status.text).toBe('1% of rows unavailable');
    // without the engine's ring the config is used
    expect(inspect(doc({ nodes: 6 }), (s) => { delete s.ring.d; }).ring.nodes.value).toBe(6);
  });
});
