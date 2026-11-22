import { describe, expect, test } from 'vitest';
import { buildDesign } from '../src/build';
import { docToSpec } from '../src/readback';
import { simulationReport } from '../src/report';
import { DESIGN_GUIDE } from '../src/catalog';
import { c, spec } from './helpers';

const bus = (mode?: 'pubsub' | 'work', users = 20000) => buildDesign(spec({
  users,
  components: [
    c('Users', 'users'), c('API', 'app', { size: '64vCPU' }), c('Bus', 'queue', mode ? { queue: { mode } } : {}),
    c('Fast', 'worker', { size: '64vCPU' }), c('Slow', 'worker', { size: '2vCPU' }),
  ],
  connections: [
    { from: 'Users', to: 'API' }, { from: 'API', to: 'Bus', async: true },
    { from: 'Bus', to: 'Fast', async: true }, { from: 'Bus', to: 'Slow', async: true },
  ],
}));

describe('queue delivery mode in the spec', () => {
  test('queue.mode maps to the node; the default comes from the technology', () => {
    expect(bus('work').doc.nodes.find((n) => n.label === 'Bus')!.queuec).toEqual({ mode: 'work' });
    expect(bus().doc.nodes.find((n) => n.label === 'Bus')!.queuec).toBeUndefined();
  });

  test('queue settings on something else are ignored with a warning', () => {
    const r = buildDesign(spec({ components: [c('Users', 'users'), c('API', 'app', { queue: { mode: 'work' } })] }));
    expect(r.warnings).toContain('queue settings on "API" were ignored: it is not a queue.');
    expect(r.doc.nodes[1].queuec).toBeUndefined();
    // an empty queue block changes nothing
    expect(buildDesign(spec({ components: [c('Users', 'users'), c('Q', 'queue', { queue: {} })] })).doc.nodes[1].queuec).toBeUndefined();
  });

  test('readback always states the effective mode', () => {
    const q = (s: ReturnType<typeof docToSpec>) => s.components.find((x) => x.name === 'Bus')!;
    expect(q(docToSpec('x', bus().doc)).queue).toEqual({ mode: 'pubsub' }); // Kafka default
    expect(q(docToSpec('x', bus('work').doc)).queue).toEqual({ mode: 'work' });
  });

  test('the report lists subscribers that fall behind', () => {
    const r = simulationReport(bus('pubsub').doc, { seconds: 5 });
    expect(r.queues[0].mode).toBe('pubsub');
    expect(r.queues[0].subscribers.map((s) => s.component)).toEqual(['Fast', 'Slow']);
    expect(r.queues[0].subscribers[1].behindMessages).toBeGreaterThan(0);
    expect(r.text).toMatch(/Queue Bus \(pub\/sub, every subscriber gets every message\): 2 subscribers; behind: Slow [\d.]+k \(growing \+[\d.]+k\/s\)\./);
  });

  test('the report says when every subscriber keeps up, and when one is draining', () => {
    const calm = simulationReport(bus('pubsub', 1000).doc, { seconds: 2 });
    expect(calm.text).toContain('Queue Bus (pub/sub, every subscriber gets every message): 2 subscribers, all keeping up.');
    const one = buildDesign(spec({
      users: 1000,
      components: [c('Users', 'users'), c('API', 'app'), c('Bus', 'queue', { queue: { mode: 'pubsub' } }), c('W', 'worker')],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'Bus', async: true }, { from: 'Bus', to: 'W', async: true }],
    }));
    expect(simulationReport(one.doc, { seconds: 1 }).text).toContain('1 subscriber, all keeping up.');
  });

  test('the design guide explains pub/sub vs work queues', () => {
    expect(DESIGN_GUIDE).toMatch(/Kafka is pub\/sub/);
  });
});
