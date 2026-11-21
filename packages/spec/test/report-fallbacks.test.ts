import { describe, test, expect, vi, afterEach } from 'vitest';
import { buildDesign } from '../src/build';
import { simulationReport } from '../src/report';
import { c, spec } from './helpers';

/**
 * Cases the real engine never produces for a fresh report, but simulationReport guards against:
 * - a simulation result that lacks per-node numbers (load / inflow / latency / replicas);
 * - a cache that is still warming up. simulationReport always starts from a warm runtime and the
 *   doc does not change while it runs, so a cache only loses hits when it or its database is
 *   offline, and those cases print their own line first.
 * The engine is wrapped so these states can be produced.
 */
const hooks = vi.hoisted(() => ({ strip: [] as string[], coldCache: null as string | null }));

vi.mock('@syslab/sim', async (importOriginal) => {
  const real = await importOriginal<typeof import('@syslab/sim')>();
  return {
    ...real,
    simulate: (...args: Parameters<typeof real.simulate>) => {
      const sim = real.simulate(...args);
      for (const id of hooks.strip) {
        delete sim.load[id];
        delete sim.inflow[id];
        delete sim.nodeLatency[id];
        delete sim.reps[id];
      }
      return sim;
    },
    stepRuntime: (...args: Parameters<typeof real.stepRuntime>) => {
      const step = real.stepRuntime(...args);
      if (!hooks.coldCache) return step;
      return { runtime: { ...(step?.runtime ?? args[2]), cacheHit: { [hooks.coldCache]: 0.5 } }, events: step?.events ?? [] };
    },
  };
});

afterEach(() => { hooks.strip = []; hooks.coldCache = null; });

describe('simulationReport: defensive fallbacks', () => {
  test('missing per-node numbers count as zero load, zero traffic and one replica', () => {
    const { doc } = buildDesign(spec({
      components: [c('Users', 'users'), c('LB', 'lb'), c('A', 'app'), c('B', 'app')],
      connections: [{ from: 'Users', to: 'LB' }, { from: 'LB', to: 'A' }, { from: 'LB', to: 'B' }],
    }));
    hooks.strip = ['n_lb', 'n_a', 'n_b'];
    const r = simulationReport(doc, { seconds: 0 });
    expect(r.overloaded).toEqual([]);
    expect(r.busiest).toEqual({ component: 'LB', loadPercent: 0 });
    expect(r.components).toEqual([
      { component: 'LB', kind: 'lb', requestsPerSecond: 0, loadPercent: 0, latencyMs: 0, offline: false },
      { component: 'A', kind: 'app', requestsPerSecond: 0, loadPercent: 0, latencyMs: 0, offline: false },
      { component: 'B', kind: 'app', requestsPerSecond: 0, loadPercent: 0, latencyMs: 0, offline: false },
    ]);
    expect(r.loadBalancers).toEqual([{ component: 'LB', algorithm: 'Round robin', split: 'A 50%, B 50%' }]);
  });

  test('a cache below its normal hit rate is reported as warming up', () => {
    const { doc } = buildDesign(spec({
      components: [c('Users', 'users'), c('API', 'app'), c('Redis', 'cache'), c('DB', 'db')],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Redis' }, { from: 'Redis', to: 'DB' }],
    }));
    hooks.coldCache = 'n_redis';
    const r = simulationReport(doc, { seconds: 1 });
    expect(r.text).toContain('Redis is warming up: hit rate 50%, the rest miss and go to the database.');
  });
});
