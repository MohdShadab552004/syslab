import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '@syslab/types';
import { blankDoc, costBreakdown, makeEdge, makeNode, simulate } from '@syslab/sim';
import { HISTORY_MAX, buildCharts, nodeTrend, pushSample, sampleOf, spanLabel, type Sample } from '@/lib/metrics/history';
import { buildCostView } from '@/lib/metrics/cost';

const N = makeNode, E = makeEdge;
const doc = (users = 12000): DesignDoc => blankDoc({
  users,
  nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A', { replicas: 2 }), N('c', 'cache', 600, 0, 'C'), N('q', 'queue', 600, 300, 'Q', { queuec: { mode: 'work' } }), N('w', 'worker', 900, 300, 'W', { size: 0 })],
  edges: [E('ua', 'u', 'a'), E('ac', 'a', 'c'), E('aq', 'a', 'q', { mode: 'async', calls: 1 }), E('qw', 'q', 'w', { mode: 'async' })],
});
const s = (over: Partial<Sample> = {}): Sample => ({
  t: 0, rps: 100, served: 100, p95: 50, p99: 80, errors: 0, cost: 1000, replicas: 2, backlog: 0, load: { a: 0.5 }, latency: { a: 20 }, events: [], ...over,
});

describe('sampleOf', () => {
  it('takes one second of the simulation', () => {
    const d = doc();
    const sim = simulate(d, { autoRep: {}, drain: {}, autoSize: {}, spike: 1, qDepth: { q: 500 } });
    const x = sampleOf(d, sim, 1234, ['W scaled out']);
    expect(x).toMatchObject({ t: 1234, rps: 720, served: 720, errors: 0, events: ['W scaled out'] });
    expect(x.replicas).toBe(3); // app (2 replicas but no load balancer: one works) + cache + worker
    expect(x.backlog).toBe(500);
    expect(x.p95).toBeGreaterThan(0);
    expect(x.cost).toBeCloseTo(sim.cost, 6);
    expect(Object.keys(x.load)).toEqual(['a', 'c', 'q', 'w']); // users left out
    expect(x.latency.a).toBeGreaterThan(0);
  });

  it('no traffic means no latency; no events by default', () => {
    const x = sampleOf(doc(0), simulate(doc(0)), 0);
    expect(x.p95).toBe(0);
    expect(x.p99).toBe(0);
    expect(x.events).toEqual([]);
  });

  it('missing simulation fields count as zero', () => {
    const d = doc();
    const sim = simulate(d);
    delete sim.load.a; delete sim.nodeLatency.a; delete sim.reps.a; delete sim.queue.q;
    const x = sampleOf(d, sim, 0);
    expect(x.load.a).toBe(0);
    expect(x.latency.a).toBe(0);
    expect(x.backlog).toBe(0);
    expect(x.replicas).toBe(3); // a missing replica count is one instance
  });
});

describe('pushSample', () => {
  it('appends and keeps the last N', () => {
    let h: Sample[] = [];
    for (let i = 0; i < 5; i++) h = pushSample(h, s({ t: i }), 3);
    expect(h.map((x) => x.t)).toEqual([2, 3, 4]);
    expect(HISTORY_MAX).toBe(300);
    const before = [s({ t: 1 })];
    expect(pushSample(before, s({ t: 2 }))).not.toBe(before);
    expect(before).toHaveLength(1);
  });
});

describe('buildCharts', () => {
  it('six charts with values, axis tops, the SLO line and event marks', () => {
    const h = [s({ t: 0 }), s({ t: 1000, events: ['A scaled out'] }), s({ t: 2000, rps: 200, served: 150, p95: 300, p99: 400, errors: 0.25, backlog: 50 })];
    const c = buildCharts(h, 200);
    expect(c.map((x) => x.key)).toEqual(['tput', 'p95', 'err', 'reps', 'backlog', 'cost']);
    const by = Object.fromEntries(c.map((x) => [x.key, x]));
    expect(by.tput).toMatchObject({ value: '150 rps', bad: true, points: [100, 100, 150], secondary: [100, 100, 200] });
    expect(by.tput.max).toBeCloseTo(220, 6);
    expect(by.p95).toMatchObject({ value: '300 ms', bad: true, threshold: { value: 200, label: 'SLO 200 ms' }, marks: [1] });
    expect(by.p95.max).toBeCloseTo(440, 6);
    expect(by.err).toMatchObject({ value: '25%', bad: true });
    expect(by.backlog).toMatchObject({ value: '50 msgs', bad: true });
    expect(by.reps).toMatchObject({ value: '2', bad: false, maxText: '2' });
    expect(by.cost).toMatchObject({ value: '$1,000', maxText: '$1,100' });
  });

  it('small error rates keep a decimal; a calm run is not flagged', () => {
    const c = buildCharts([s(), s({ errors: 0.012, backlog: 0 })], 200);
    expect(c[2].value).toBe('1.2%');
    expect(c[4].bad).toBe(false);
    expect(c[0].bad).toBe(false);
  });

  it('empty history: placeholders and a non-zero axis', () => {
    const c = buildCharts([], 200);
    expect(c.every((x) => x.value === '—' && x.points.length === 0 && !x.bad)).toBe(true);
    expect(c[0].max).toBe(1);
    expect(c[1].max).toBeCloseTo(220, 6); // the SLO stays visible
  });
});

describe('nodeTrend and spanLabel', () => {
  it('a node over the last samples, or null with too little data', () => {
    const h = [s({ load: { a: 0.1 }, latency: { a: 5 } }), s({ load: { a: 0.2 }, latency: {} }), s({ load: {} })];
    expect(nodeTrend(h, 'a')).toEqual({ load: [0.1, 0.2], latency: [5, 0] });
    expect(nodeTrend(h, 'a', 1)).toBeNull();
    expect(nodeTrend(h, 'zzz')).toBeNull();
  });

  it('how long the history covers', () => {
    expect(spanLabel([])).toBe('');
    expect(spanLabel([s({ t: 0 }), s({ t: 45_000 })])).toBe('−45s');
    expect(spanLabel([s({ t: 0 }), s({ t: 120_000 })])).toBe('−2m');
    expect(spanLabel([s({ t: 0 }), s({ t: 150_000 })])).toBe('−2m 30s');
  });
});

describe('buildCostView', () => {
  it('totals, categories with shares, top items and savings', () => {
    const d = doc(40000);
    const v = buildCostView(costBreakdown(d, simulate(d)), 3);
    expect(v.total).toMatch(/^\$[\d,]+\/month$/);
    expect(v.source).toMatch(/^AWS us-east-1/);
    expect(v.categories[0].label).toBeTruthy();
    expect(v.categories.reduce((t, c) => t + c.pct, 0)).toBeGreaterThanOrEqual(98);
    expect(v.items).toHaveLength(3);
    expect(v.items[0]).toMatchObject({ amount: expect.stringMatching(/^\$/) });
    expect(v.savings[0].amount).toMatch(/^−\$[\d,]+\/mo$/);
    expect(v.bestSaving).toMatch(/^\$/);
  });

  it('a design that costs nothing', () => {
    const v = buildCostView({ total: 0, source: 'x', items: [], byCategory: [{ category: 'cdn', monthly: 0 }], savings: [] });
    expect(v).toEqual({ total: '$0/month', source: 'x', categories: [{ key: 'cdn', label: 'CDN', amount: '$0', pct: 0 }], items: [], savings: [], bestSaving: null });
  });
});
