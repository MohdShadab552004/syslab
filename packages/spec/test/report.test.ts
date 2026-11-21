import { describe, test, expect } from 'vitest';
import type { DesignDoc } from '@syslab/types';
import { makeEdge } from '@syslab/sim';
import { buildDesign } from '../src/build';
import { simulationReport } from '../src/report';
import type { DesignSpecInput } from '../src/schema';
import { c, nodeOf, spec } from './helpers';

const docOf = (s: Partial<DesignSpecInput>) => buildDesign(spec(s)).doc;
const lines = (text: string) => text.split('\n');

/** users → API → DB, the smallest design with traffic. */
const simple = (patch: Partial<DesignSpecInput> = {}) => docOf({
  components: [c('Users', 'users'), c('API', 'app'), c('DB', 'db')],
  connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'DB' }],
  ...patch,
});

describe('simulationReport: basics', () => {
  test('a healthy design', () => {
    const r = simulationReport(simple());
    expect(r.users).toBe(12_000);
    expect(r.requestsPerSecond).toBe(720);
    expect(r.latencyTargetMs).toBe(200);
    expect(r.p95Ms).toBeGreaterThan(0);
    expect(r.p99Ms).toBeGreaterThanOrEqual(r.p95Ms!);
    expect(r.meanLatencyMs).toBeGreaterThan(0);
    expect(r.meetsLatencyTarget).toBe(true);
    expect(r.errorRatePercent).toBe(0);
    expect(r.monthlyCostUsd).toBeGreaterThan(0);
    expect(r.overloaded).toEqual([]);
    expect(r.busiest).toEqual({ component: expect.any(String), loadPercent: expect.any(Number) });
    expect(r.components.map((x) => x.component)).toEqual(['API', 'DB']); // users are left out
    expect(r.components[0]).toMatchObject({ kind: 'app', requestsPerSecond: 720, offline: false });
    expect(r.components[0].latencyMs).toBeGreaterThan(0);
    expect(r.issues).toEqual([]);
    expect(r.scaling).toEqual([]);
    expect(r.queues).toEqual([]);
    expect(r.loadBalancers).toEqual([]);
    const l = lines(r.text);
    expect(l[0]).toBe('Traffic: 12k concurrent users → 720 requests/s.');
    expect(l[1]).toMatch(/^P95 latency: \d+ ms vs target 200 ms → OK\. \(mean \d+ ms, P99 \d+ ms\)$/);
    expect(l[2]).toMatch(/^Errors: 0\.0%\. Cost: \$[\d,]+\/month\.$/);
    expect(l[3]).toMatch(/^No component is overloaded; busiest is (API|DB) at \d+%\.$/);
    expect(l[4]).toMatch(/^Per component: API 720 rps \d+%, DB 720 rps \d+%\.$/);
    expect(l).toHaveLength(5);
  });

  test('no traffic: zero users', () => {
    const r = simulationReport(simple({ users: 0 }));
    expect(r.requestsPerSecond).toBe(0);
    expect(r.p95Ms).toBeNull();
    expect(r.p99Ms).toBeNull();
    expect(r.meanLatencyMs).toBeNull();
    expect(r.meetsLatencyTarget).toBe(true);
    expect(r.busiest).toBeNull();
    expect(lines(r.text)).toEqual([
      'Traffic: 0 concurrent users → 0 requests/s.',
      'P95 latency: — (no traffic) vs target 200 ms → OK.',
      'Errors: 0.0%. Cost: $1,440/month.',
      'No traffic, so nothing is loaded.',
    ]);
  });

  test('no users component: a note at the end', () => {
    const r = simulationReport(docOf({ components: [c('API', 'app')] }));
    expect(r.requestsPerSecond).toBeGreaterThan(0); // doc.users still counts, but nothing sends it
    expect(lines(r.text).at(-1)).toBe('Note: there is no users component, so the design receives no traffic.');
  });

  test('only a users component: nothing to rank as busiest', () => {
    const r = simulationReport(docOf({}));
    expect(r.requestsPerSecond).toBe(720);
    expect(r.components).toEqual([]);
    expect(r.busiest).toBeNull();
    expect(r.overloaded).toEqual([]);
  });

  test('users override is rounded and clamped at zero', () => {
    expect(simulationReport(simple(), { users: 1234.6 }).users).toBe(1235);
    expect(simulationReport(simple(), { users: -50 }).users).toBe(0);
    expect(simulationReport(simple(), { users: 0 }).busiest).toBeNull();
  });

  test('a spike multiplies the users and is named in the text', () => {
    const r = simulationReport(simple(), { spike: 3 });
    expect(r.users).toBe(36_000);
    expect(r.requestsPerSecond).toBe(2160);
    expect(lines(r.text)[0]).toBe('Traffic: 36k concurrent users (spike ×3) → 2.2k requests/s.');
    expect(lines(simulationReport(simple(), { spike: 1 }).text)[0]).not.toContain('spike');
  });

  test('latency over target', () => {
    const r = simulationReport(simple({ latencyTargetMs: 5 }));
    expect(r.meetsLatencyTarget).toBe(false);
    expect(r.latencyTargetMs).toBe(5);
    expect(lines(r.text)[1]).toMatch(/vs target 5 ms → TOO SLOW\./);
  });

  test('offline components are listed last with no load', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('Down', 'app', { offline: true }), c('API', 'app')],
      connections: [{ from: 'Users', to: 'API' }, { from: 'Users', to: 'Down' }],
    });
    const r = simulationReport(doc);
    expect(r.components.map((x) => [x.component, x.offline])).toEqual([['API', false], ['Down', true]]);
    expect(r.components[1].loadPercent).toBe(0);
    expect(r.text).toContain('Down OFFLINE');
    expect(r.errorRatePercent).toBeGreaterThan(0);
  });

  test('more than 15 components are cut short in the text', () => {
    const names = Array.from({ length: 17 }, (_, i) => `S${i}`);
    const doc = docOf({ components: [c('Users', 'users'), ...names.map((n) => c(n, 'app'))], connections: names.map((n) => ({ from: 'Users', to: n })) });
    const r = simulationReport(doc);
    expect(r.components).toHaveLength(17);
    const per = lines(r.text).find((l) => l.startsWith('Per component:'))!;
    expect(per.endsWith(', ….')).toBe(true);
    expect(per).toContain('S14 ');
    expect(per).not.toContain('S15 ');
  });

  test('edges to nodes that no longer exist fall back to the id', () => {
    const doc = simple();
    doc.edges.push(makeEdge('e_x', 'n_api', 'n_ghost', { retries: 2 }));
    expect(() => simulationReport(doc)).not.toThrow();
  });
});

describe('simulationReport: overload and issues', () => {
  test('overloaded components are sorted by load', () => {
    const doc = docOf({
      users: 200_000,
      components: [c('Users', 'users'), c('API', 'app', { size: '2vCPU' }), c('Mail', 'ext', { tech: 'Email (SES)' })],
      connections: [{ from: 'Users', to: 'API' }, { from: 'Users', to: 'Mail' }],
    });
    const r = simulationReport(doc);
    expect(r.overloaded.length).toBe(2);
    expect(r.overloaded[0].loadPercent).toBeGreaterThanOrEqual(r.overloaded[1].loadPercent);
    expect(r.overloaded.every((o) => o.loadPercent > 100)).toBe(true);
    expect(r.text).toContain(`Overloaded: ${r.overloaded.map((o) => `${o.component} ${o.loadPercent}%`).join(', ')}.`);
    expect(r.errorRatePercent).toBeGreaterThan(0);
  });

  test('connection limit of a database', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('LB', 'lb'), c('API', 'app', { replicas: 15 }), c('DB', 'db')],
      connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'API' }, { from: 'API', to: 'DB' }],
    });
    const r = simulationReport(doc);
    expect(r.issues).toEqual([
      'DB has too many connections: 150 needed (15 app/worker instances × 10) but only 100 allowed, so 33% of its queries are refused. Set database.maxConnections (10000 = a pooler like PgBouncer) or add read replicas.',
    ]);
    expect(r.text).toContain(r.issues[0]);
    // a pooler fixes it
    const fixed = docOf({
      components: [c('Users', 'users'), c('LB', 'lb'), c('API', 'app', { replicas: 15 }), c('DB', 'db', { database: { maxConnections: 10_000 } })],
      connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'API' }, { from: 'API', to: 'DB' }],
    });
    expect(simulationReport(fixed).issues).toEqual([]);
  });

  test('retry storm', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('API', 'app'), c('Pay', 'ext', { tech: 'Payment gateway' })],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Pay', retries: 3 }],
    });
    const r = simulationReport(doc);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatch(/^Retries on API → Pay multiply its traffic ×\d\.\d because Pay is dropping requests \(retry storm\)\. Fix the capacity of Pay, or add a circuit breaker\.$/);
    // with no time to react there is no storm yet
    expect(simulationReport(doc, { seconds: 0 }).issues).toEqual([]);
  });

  test('open circuit breaker', () => {
    const doc = docOf({
      users: 30_000,
      components: [c('Users', 'users'), c('API', 'app'), c('Pay', 'ext', { tech: 'Payment gateway' })],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Pay', circuitBreaker: true, retries: 2 }],
    });
    const r = simulationReport(doc);
    expect(r.issues).toEqual(['Circuit breaker API → Pay is open: calls fail fast while Pay recovers.']);
    expect(r.components.find((x) => x.component === 'Pay')!.requestsPerSecond).toBe(0);
  });
});

describe('simulationReport: time', () => {
  const queued = (size: '2vCPU' | '8vCPU') => docOf({
    users: 100_000,
    components: [c('Users', 'users'), c('API', 'app', { size: '192vCPU' }), c('Q', 'queue'), c('W', 'worker', { size, autoscale: { min: 1, max: 50 } })],
    connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Q', async: true }, { from: 'Q', to: 'W', async: true }],
  });

  test('autoscaling events are reported with their time, the text keeps the last six', () => {
    const r = simulationReport(queued('2vCPU'), { seconds: 10 });
    expect(r.scaling[0]).toBe('t=1s W scaled out 1 → 2');
    expect(r.scaling).toHaveLength(10);
    const line = lines(r.text).find((l) => l.startsWith('Autoscaling'))!;
    expect(line).toBe(`Autoscaling during the first 10s: ${r.scaling.slice(-6).join('; ')}.`);
  });

  test('queue growing, draining and steady', () => {
    const growing = simulationReport(queued('2vCPU'), { seconds: 10 });
    expect(growing.queues).toEqual([{ component: 'Q', waitingMessages: expect.any(Number), changePerSecond: expect.any(Number) }]);
    expect(growing.queues[0].changePerSecond).toBeGreaterThan(0);
    expect(growing.text).toMatch(/Queue Q: [\d.]+k waiting, growing \+[\d.]+k\/s\./);

    const draining = simulationReport(queued('8vCPU'), { seconds: 10 });
    expect(draining.queues[0].changePerSecond).toBeLessThan(0);
    expect(draining.text).toMatch(/Queue Q: [\d.]+k waiting, draining [\d.]+k\/s\./);

    const steady = simulationReport(queued('8vCPU'), { seconds: 60 });
    expect(steady.queues).toEqual([{ component: 'Q', waitingMessages: 0, changePerSecond: 0 }]);
    expect(steady.text).toContain('Queue Q: 0 waiting, steady.');
  });

  test('scale-in is reported but draining notices are not', () => {
    const r = simulationReport(queued('8vCPU'), { seconds: 30 });
    expect(r.scaling.some((s) => s.includes('scaled in'))).toBe(true);
    expect(r.scaling.some((s) => s.includes('Draining'))).toBe(false);
  });

  test('seconds are clamped to 0..300 (default 60)', () => {
    const doc = queued('8vCPU');
    expect(lines(simulationReport(doc, { seconds: 10_000 }).text).find((l) => l.startsWith('Autoscaling'))).toMatch(/^Autoscaling during the first 300s: /);
    expect(lines(simulationReport(doc).text).find((l) => l.startsWith('Autoscaling'))).toMatch(/^Autoscaling during the first 60s: /);
    const none = simulationReport(doc, { seconds: -5 });
    expect(none.scaling).toEqual([]);
    expect(none.text).not.toContain('Autoscaling');
    expect(none.queues[0]).toEqual({ component: 'Q', waitingMessages: 0, changePerSecond: expect.any(Number) });
  });

  test('a steady design stops early (nothing changes)', () => {
    expect(simulationReport(simple(), { seconds: 300 })).toEqual(simulationReport(simple(), { seconds: 1 }));
  });
});

describe('simulationReport: load balancers', () => {
  test('split per backend replica, offline backends skipped', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('LB', 'lb', { loadBalancer: { algorithm: 'weighted' } }), c('A', 'app', { replicas: 2 }), c('B', 'app'), c('Dead', 'app', { offline: true })],
      connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'A' }, { from: 'LB', to: 'B', weight: 2 }, { from: 'LB', to: 'Dead' }],
    });
    const r = simulationReport(doc);
    expect(r.loadBalancers).toEqual([{ component: 'LB', algorithm: 'Weighted', split: 'A #1 25%, A #2 25%, B 50%' }]);
    expect(r.text).toContain('LB (Weighted): A #1 25%, A #2 25%, B 50%.');
  });

  test('every algorithm is named', () => {
    const names = { round_robin: 'Round robin', weighted: 'Weighted', least_connections: 'Least connections', ip_hash: expect.any(String) } as const;
    for (const [algorithm, label] of Object.entries(names)) {
      const doc = docOf({
        components: [c('Users', 'users'), c('LB', 'lb', { loadBalancer: { algorithm: algorithm as keyof typeof names } }), c('A', 'app'), c('B', 'app')],
        connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'A' }, { from: 'LB', to: 'B' }],
      });
      const lb = simulationReport(doc).loadBalancers[0];
      expect(lb.algorithm).toEqual(label);
      expect(lb.algorithm).not.toBe('');
      expect(lb.split).toMatch(/^A \d+%, B \d+%$/);
    }
  });

  test('an lb with no backends is left out; an unknown algorithm has an empty name', () => {
    const lonely = docOf({ components: [c('Users', 'users'), c('LB', 'lb')], connections: [{ from: 'Users', to: 'LB' }] });
    expect(simulationReport(lonely).loadBalancers).toEqual([]);

    const doc = docOf({ components: [c('Users', 'users'), c('LB', 'lb'), c('A', 'app')], connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'A' }] });
    nodeOf(doc, 'LB').lbc = { algo: 'bogus' as never };
    expect(simulationReport(doc).loadBalancers).toEqual([{ component: 'LB', algorithm: '', split: 'A 100%' }]);
  });
});

describe('simulationReport: caches', () => {
  const cacheLine = (doc: DesignDoc, seconds?: number) => lines(simulationReport(doc, { seconds }).text).filter((l) => l.startsWith('Redis'));

  test('a warm cache adds no line', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('API', 'app'), c('Redis', 'cache'), c('DB', 'db')],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Redis' }, { from: 'Redis', to: 'DB' }],
    });
    expect(cacheLine(doc)).toEqual([]);
  });

  test('an offline read-through cache sends its reads to the database', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('API', 'app'), c('Redis', 'cache', { offline: true }), c('DB', 'db')],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Redis' }, { from: 'Redis', to: 'DB' }],
    });
    expect(cacheLine(doc)).toEqual(['Redis is offline: its reads go to the database instead.']);
  });

  test('an offline cache-aside cache also falls back to the database', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('API', 'app'), c('Redis', 'cache', { offline: true }), c('DB', 'db')],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Redis' }, { from: 'API', to: 'DB' }],
    });
    expect(cacheLine(doc)).toEqual(['Redis is offline: its reads go to the database instead.']);
  });

  test('an offline cache with nothing behind it fails its reads', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('API', 'app'), c('Redis', 'cache', { offline: true })],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Redis' }],
    });
    expect(cacheLine(doc)).toEqual(['Redis is offline and nothing is behind it: its reads fail.']);
  });

  test('a cache whose database is offline expires its keys over the TTL', () => {
    const doc = docOf({
      components: [c('Users', 'users'), c('API', 'app'), c('Redis', 'cache', { cache: { ttlSeconds: 20 } }), c('DB', 'db', { offline: true })],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Redis' }, { from: 'Redis', to: 'DB' }],
    });
    expect(cacheLine(doc, 10)).toEqual(['Redis: the database behind it is offline, so expired keys cannot refill (TTL 20s). Hit rate now 45%; misses and writes fail.']);
    expect(cacheLine(doc, 60)).toEqual(['Redis: the database behind it is offline, so expired keys cannot refill (TTL 20s). Hit rate now 0%; misses and writes fail.']);
    // before any time passes the cache is still full
    expect(cacheLine(doc, 0)).toEqual(['Redis: the database behind it is offline, so expired keys cannot refill (TTL 20s). Hit rate now 90%; misses and writes fail.']);
  });
});
