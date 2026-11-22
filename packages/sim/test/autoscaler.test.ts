import { describe, expect, test } from 'vitest';
import { S, design, run } from './helpers';

const rt0 = (over = {}) => ({ ...S.EMPTY_RUNTIME, ...over });
const docOf = (...nodes) => S.blankDoc({ nodes });
const api = (over = {}) => S.makeNode('a', 'app', 0, 0, 'API', over);
/** a hand-made simulation result with only the fields the runtime steps read */
const sim = (over = {}) => ({
  desiredReps: {}, reps: {}, desiredSize: {}, sizeIdx: {}, queue: {}, inflow: {}, cacheRefill: {}, dropFrac: {}, edgeRps: {}, ...over,
});

describe('stepAutoscaler: horizontal', () => {
  test('scales out one replica at a time when close, two at a time when far', () => {
    const near = S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 5 }, reps: { a: 2 } }), rt0(), 7000);
    expect(near.runtime.autoRep).toEqual({ a: 3 });
    expect(near.events).toEqual([{ id: '7000-0', at: 7000, up: true, text: 'API scaled out 2 → 3' }]);
    const far = S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 10 }, reps: { a: 2 } }), rt0(), 0);
    expect(far.runtime.autoRep).toEqual({ a: 4 });
  });

  test('scaling out cancels a drain in progress', () => {
    const r = S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 4 }, reps: { a: 3 } }), rt0({ drain: { a: 1 } }), 0);
    expect(r.runtime.drain).toEqual({});
    expect(r.runtime.autoRep.a).toBe(4);
  });

  test('scale-in drains the last replica for DRAIN_TICKS ticks before removing it', () => {
    const doc = docOf(api()), s = sim({ desiredReps: { a: 2 }, reps: { a: 4 } });
    const t1 = S.stepAutoscaler(doc, s, rt0(), 1);
    expect(t1.runtime.drain).toEqual({ a: 1 });
    expect(t1.runtime.autoRep).toEqual({});
    expect(t1.events.map((e) => [e.up, e.text])).toEqual([[false, 'Draining API D']]);
    const t2 = S.stepAutoscaler(doc, s, t1.runtime, 2);
    expect(t2.runtime.drain).toEqual({ a: 2 });
    expect(t2.events).toEqual([]); // still draining: changed, but no new event
    const t3 = S.stepAutoscaler(doc, s, t2.runtime, 3);
    expect(S.DRAIN_TICKS).toBe(2);
    expect(t3.runtime.drain).toEqual({});
    expect(t3.runtime.autoRep).toEqual({ a: 3 });
    expect(t3.events.map((e) => [e.up, e.text])).toEqual([[false, 'API scaled in 4 → 3']]);
  });

  test('the drained replica letter stops at H', () => {
    const r = S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 2 }, reps: { a: 12 } }), rt0(), 0);
    expect(r.events[0].text).toBe('Draining API H');
  });

  test('a drain is cancelled when demand comes back to the current count', () => {
    const r = S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 3 }, reps: { a: 3 } }), rt0({ drain: { a: 1 } }), 0);
    expect(r.runtime.drain).toEqual({});
    expect(r.events).toEqual([]);
  });

  test('nothing to do returns null', () => {
    expect(S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 3 }, reps: { a: 3 } }), rt0(), 0)).toBeNull();
    expect(S.stepAutoscaler(docOf(api()), sim(), rt0(), 0)).toBeNull();
  });

  test('does not mutate the runtime it was given', () => {
    const rt = rt0({ drain: { a: 1 } });
    S.stepAutoscaler(docOf(api()), sim({ desiredReps: { a: 9 }, reps: { a: 3 } }), rt, 0);
    expect(rt).toEqual(rt0({ drain: { a: 1 } }));
  });
});

describe('stepAutoscaler: vertical', () => {
  test('resizes one step up toward the wanted size', () => {
    const r = S.stepAutoscaler(docOf(api()), sim({ desiredSize: { a: 3 }, sizeIdx: { a: 1 } }), rt0(), 0);
    expect(r.runtime.autoSize).toEqual({ a: 2 });
    expect(r.events.map((e) => [e.up, e.text])).toEqual([[true, 'API resized up 8 → 16 vCPU']]);
  });

  test('resizes one step down', () => {
    const r = S.stepAutoscaler(docOf(api()), sim({ desiredSize: { a: 0 }, sizeIdx: { a: 2 } }), rt0(), 0);
    expect(r.runtime.autoSize).toEqual({ a: 1 });
    expect(r.events.map((e) => [e.up, e.text])).toEqual([[false, 'API resized down 16 → 8 vCPU']]);
  });

  test('at the wanted size nothing changes', () => {
    expect(S.stepAutoscaler(docOf(api()), sim({ desiredSize: { a: 2 }, sizeIdx: { a: 2 } }), rt0(), 0)).toBeNull();
  });
});

describe('autoscaling over time', () => {
  test('vertical autoscaling grows under load, stops at what is needed, and shrinks when traffic falls', () => {
    const d = design({ users: 20000 }, ['u', 'users'], ['a', 'app', { autoscale: S.autoV(0, 4) }]).edge('u', 'a');
    const start = S.simulate(d.doc);
    expect(start.sizeIdx.a).toBe(0); // starts at minSize
    // 1200 rps at 60% target: 2 vCPU 180, 8 vCPU 720, 16 vCPU 1440 → size 2
    expect(start.desiredSize.a).toBe(2);
    const up = run(d.doc, 5);
    expect(up.sim.sizeIdx.a).toBe(2);
    expect(up.rt.autoSize.a).toBe(2);
    expect(up.sim.errorRate).toBe(0);
    d.doc.users = 1000; // 60 rps fits the smallest box
    const down = run(d.doc, 5, up.rt);
    expect(down.sim.desiredSize.a).toBe(0);
    expect(down.sim.sizeIdx.a).toBe(0);
  });

  test('vertical autoscaling stops at maxSize even when that is not enough', () => {
    const d = design({ users: 1_000_000 }, ['u', 'users'], ['a', 'app', { autoscale: S.autoV(1, 3) }]).edge('u', 'a');
    const { sim } = run(d.doc, 10);
    expect(sim.desiredSize.a).toBe(3);
    expect(sim.sizeIdx.a).toBe(3);
    expect(sim.errorRate).toBeGreaterThan(0);
  });

  test('vertical autoscaling uses the replica count in its target', () => {
    const d = design({ users: 20000 }, ['u', 'users'], ['lb', 'lb'], ['a', 'app', { replicas: 2, autoscale: S.autoV(0, 4) }]).edge('u', 'lb').edge('lb', 'a');
    // 1200 rps over 2 replicas: 2 × 720 ≥ 1200 → size 1
    expect(S.simulate(d.doc).desiredSize.a).toBe(1);
  });

  test('horizontal autoscaling scales in, one drained replica at a time', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['lb', 'lb'], ['a', 'app', { autoscale: S.autoH(2, 10) }]).edge('u', 'lb').edge('lb', 'a');
    const rt = rt0({ autoRep: { a: 6 } });
    expect(S.simulate(d.doc, rt).reps.a).toBe(6);
    expect(S.simulate(d.doc, rt).desiredReps.a).toBe(2);
    expect(run(d.doc, 3, rt).sim.reps.a).toBe(5); // two ticks draining, then removed
    expect(run(d.doc, 30, rt).sim.reps.a).toBe(2);
  });

  test('zero traffic wants the minimum replica count', () => {
    const d = design({ users: 0 }, ['u', 'users'], ['lb', 'lb'], ['a', 'app', { autoscale: S.autoH(3, 10) }]).edge('u', 'lb').edge('lb', 'a');
    expect(S.simulate(d.doc).desiredReps.a).toBe(3);
    expect(S.simulate(d.doc).reps.a).toBe(3);
  });

  test('a horizontally autoscaled node with no load balancer stays at one replica and asks for one', () => {
    const d = design({ users: 80000 }, ['u', 'users'], ['a', 'app', { autoscale: S.autoH(2, 10) }]).edge('u', 'a');
    const s = S.simulate(d.doc);
    expect(s.needsLB.a).toBe(true);
    expect(s.reps.a).toBe(1);
    expect(s.desiredReps.a).toBeUndefined();
  });
});

describe('stepQueues', () => {
  const q = S.makeNode('q', 'queue', 0, 0, 'Q');

  test('depth grows by the net rate, clamped to [0, QUEUE_MAX]', () => {
    const doc = docOf(api(), q);
    expect(S.stepQueues(doc, sim({ queue: { q: { growth: 100 } } }), rt0())).toEqual({ q: 100 });
    expect(S.stepQueues(doc, sim({ queue: { q: { growth: -500 } } }), rt0({ qDepth: { q: 200 } }))).toEqual({});
    expect(S.stepQueues(doc, sim({ queue: { q: { growth: 5e6 } } }), rt0({ qDepth: { q: 9e5 } }))).toEqual({ q: S.QUEUE_MAX });
  });

  test('tiny changes and a missing queue stat do not count as a change', () => {
    const doc = docOf(q);
    expect(S.stepQueues(doc, sim({ queue: { q: { growth: 0.2 } } }), rt0({ qDepth: { q: 10 } }))).toBeNull();
    expect(S.stepQueues(doc, sim(), rt0())).toBeNull();
    expect(S.stepQueues(doc, sim(), { ...rt0(), qDepth: undefined })).toBeNull();
  });

  test('a queue without a stat empties', () => {
    expect(S.stepQueues(docOf(q), sim(), rt0({ qDepth: { q: 50 } }))).toEqual({});
  });

  test('depth left over from a deleted queue is dropped', () => {
    expect(S.stepQueues(docOf(api()), sim(), rt0({ qDepth: { gone: 50 } }))).toEqual({});
    expect(S.stepQueues(docOf(api()), sim(), rt0({ qDepth: { gone: 0.1 } }))).toBeNull();
    expect(S.stepQueues(docOf(api()), sim(), rt0({ qDepth: { gone: undefined } }))).toBeNull();
  });
});

describe('stepCaches', () => {
  const cache = (over = {}) => S.makeNode('c', 'cache', 0, 0, 'C', over);

  test('an offline cache loses its contents', () => {
    expect(S.stepCaches(docOf(cache({ down: true })), sim(), rt0())).toEqual({ c: 0 });
    expect(S.stepCaches(docOf(cache({ down: true })), sim(), rt0({ cacheHit: { c: 0 } }))).toBeNull();
  });

  test('with every database behind it offline, keys expire over one TTL', () => {
    const doc = docOf(cache({ cachec: { ttl: 30 } }));
    const r = S.stepCaches(doc, sim({ cacheRefill: { c: false } }), rt0());
    expect(r.c).toBeCloseTo(S.CACHE_HIT - S.CACHE_HIT / 30, 12);
    expect(S.stepCaches(doc, sim({ cacheRefill: { c: false } }), rt0({ cacheHit: { c: 0.01 } }))).toEqual({ c: 0 });
    // a TTL of 0 expires everything in one second
    expect(S.stepCaches(docOf(cache({ cachec: { ttl: 0 } })), sim({ cacheRefill: { c: false } }), rt0())).toEqual({ c: 0 });
  });

  test('traffic refills a cold cache by CACHE_WARMUP of the gap each second, snapping when close', () => {
    const doc = docOf(cache());
    const r = S.stepCaches(doc, sim({ inflow: { c: 100 } }), rt0({ cacheHit: { c: 0 } }));
    expect(r.c).toBeCloseTo(S.CACHE_HIT * S.CACHE_WARMUP, 12);
    expect(S.stepCaches(doc, sim({ inflow: { c: 100 } }), rt0({ cacheHit: { c: 0.894 } }))).toEqual({});
  });

  test('no traffic and no reason to change: nothing happens', () => {
    expect(S.stepCaches(docOf(cache()), sim(), rt0({ cacheHit: { c: 0.3 } }))).toBeNull();
    expect(S.stepCaches(docOf(cache(), api()), sim({ inflow: { c: 5 } }), rt0())).toBeNull();
  });
});

describe('stepFailures', () => {
  test('remembers what each node dropped', () => {
    expect(S.stepFailures(docOf(api()), sim({ dropFrac: { a: 0.3 } }), rt0())).toEqual({ a: 0.3 });
    expect(S.stepFailures(docOf(api()), sim({ dropFrac: { a: 0 } }), rt0({ fail: { a: 0.3 } }))).toEqual({});
  });

  test('ignores tiny changes and nodes without a result', () => {
    expect(S.stepFailures(docOf(api()), sim({ dropFrac: { a: 0.301 } }), rt0({ fail: { a: 0.3 } }))).toBeNull();
    expect(S.stepFailures(docOf(api()), sim(), rt0())).toBeNull();
  });
});

describe('stepBreakers', () => {
  const doc = (breaker = true) => S.blankDoc({ nodes: [api(), S.makeNode('x', 'ext', 0, 0, 'X')], edges: [S.makeEdge('e', 'a', 'x', { breaker })] });

  test('trips when the target drops more than half its calls', () => {
    expect(S.stepBreakers(doc(), sim({ dropFrac: { x: 0.6 }, edgeRps: { e: 10 } }), rt0())).toEqual({ e: S.BREAKER_OPEN_S });
    expect(S.stepBreakers(doc(), sim({ dropFrac: { x: 0.5 }, edgeRps: { e: 10 } }), rt0())).toBeNull();
  });

  test('does not trip without traffic or without a result', () => {
    expect(S.stepBreakers(doc(), sim({ dropFrac: { x: 1 }, edgeRps: { e: 0 } }), rt0())).toBeNull();
    expect(S.stepBreakers(doc(), sim({ dropFrac: { x: 1 } }), rt0())).toBeNull();
    expect(S.stepBreakers(doc(), sim(), rt0())).toBeNull();
  });

  test('counts down while open, then closes', () => {
    expect(S.stepBreakers(doc(), sim({ dropFrac: { x: 1 }, edgeRps: { e: 10 } }), rt0({ breaker: { e: 3 } }))).toEqual({ e: 2 });
    expect(S.stepBreakers(doc(), sim(), rt0({ breaker: { e: 1 } }))).toEqual({});
  });

  test('edges without a breaker are ignored', () => {
    expect(S.stepBreakers(doc(false), sim({ dropFrac: { x: 1 }, edgeRps: { e: 10 } }), rt0())).toBeNull();
  });
});

describe('stepRuntime', () => {
  test('null when nothing moves', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['a', 'app']).edge('u', 'a');
    expect(S.stepRuntime(d.doc, S.simulate(d.doc), rt0(), 0)).toBeNull();
  });

  test('combines every step into one runtime', () => {
    const doc = S.blankDoc({
      nodes: [api(), S.makeNode('q', 'queue', 0, 0, 'Q'), S.makeNode('c', 'cache', 0, 0, 'C', { down: true }), S.makeNode('x', 'ext', 0, 0, 'X')],
      edges: [S.makeEdge('e', 'a', 'x', { breaker: true })],
    });
    const s = sim({ desiredReps: { a: 3 }, reps: { a: 2 }, queue: { q: { growth: 10 } }, dropFrac: { x: 0.9 }, edgeRps: { e: 5 } });
    const r = S.stepRuntime(doc, s, rt0({ spike: 2 }), 42);
    expect(r.runtime).toEqual({
      autoRep: { a: 3 }, drain: {}, autoSize: {}, spike: 2,
      qDepth: { q: 10 }, cacheHit: { c: 0 }, fail: { x: 0.9 }, breaker: { e: S.BREAKER_OPEN_S },
    });
    expect(r.events).toHaveLength(1);
  });

  test('without autoscaling changes there are no events', () => {
    const doc = docOf(S.makeNode('q', 'queue', 0, 0, 'Q'));
    const r = S.stepRuntime(doc, sim({ queue: { q: { growth: 10 } } }), rt0(), 0);
    expect(r).toEqual({ runtime: { ...rt0(), qDepth: { q: 10 } }, events: [] });
  });
});
