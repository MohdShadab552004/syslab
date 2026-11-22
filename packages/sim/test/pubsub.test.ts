import { describe, expect, test } from 'vitest';
import { S, design, run } from './helpers';

/** API → queue → three subscribers: a fast one, a slow one (2 vCPU worker) and an offline one. */
const fanout = (users = 20000, queue: Record<string, unknown> = {}) =>
  design({ users }, ['u', 'users'], ['api', 'app', { size: 4 }], ['q', 'queue', queue],
    ['fast', 'worker', { size: 4 }], ['slow', 'worker', { size: 0 }], ['off', 'worker', { down: true }])
    .edge('u', 'api').edge('api', 'q', { mode: 'async' })
    .edge('q', 'fast', { mode: 'async' }).edge('q', 'slow', { mode: 'async' }).edge('q', 'off', { mode: 'async' });

describe('queue delivery mode', () => {
  test('Kafka defaults to pub/sub; SQS, RabbitMQ and unknown queues to a work queue', () => {
    const mode = (tech: string) => S.queueConfig(S.makeNode('q', 'queue', 0, 0, 'Q', { tech })).mode;
    expect(mode('Kafka')).toBe('pubsub');
    expect(mode('SQS')).toBe('work');
    expect(mode('RabbitMQ')).toBe('work');
    expect(mode('Custom bus')).toBe('work');
    expect(S.queueConfig(S.makeNode('q', 'queue', 0, 0, 'Q', { tech: 'SQS', queuec: { mode: 'pubsub' } })).mode).toBe('pubsub');
  });

  test('pub/sub: every subscriber gets every message', () => {
    const s = S.simulate(fanout(10000).doc);
    const sent = s.queue.q.inRate;
    expect(sent).toBe(600);
    expect(s.queue.q.mode).toBe('pubsub');
    expect(s.inflow.fast).toBe(600);
    expect(s.edgeRps.e3).toBe(600);
    expect(s.queue.q.subscribers.map((x) => x.nodeId)).toEqual(['fast', 'slow', 'off']);
  });

  test('work queue: the same messages are shared between consumers', () => {
    const s = S.simulate(fanout(10000, { queuec: { mode: 'work' } }).doc);
    expect(s.queue.q.mode).toBe('work');
    expect(s.queue.q.subscribers).toEqual([]);
    expect(s.inflow.fast + s.inflow.slow + s.inflow.off).toBeCloseTo(600, 6);
    expect(s.inflow.fast).toBeLessThan(600);
  });

  test('a slow or offline subscriber falls behind on its own; the producer never fails', () => {
    const s0 = S.simulate(fanout().doc);
    const sub = (id: string) => s0.queue.q.subscribers.find((x) => x.nodeId === id)!;
    // 1.2k msg/s: the 2 vCPU worker (120/s) and the offline one cannot keep up
    expect(sub('fast').growth).toBe(0);
    expect(sub('slow').outRate).toBe(120);
    expect(sub('slow').growth).toBe(1080);
    expect(sub('off').outRate).toBe(0);
    expect(sub('off').growth).toBe(1200);
    expect(s0.errorRate).toBe(0);
    // the queue is as far behind as its slowest subscriber
    expect(s0.queue.q.growth).toBe(1200);
    expect(s0.queue.q.drainCap).toBe(0);
    expect(s0.queue.q.consumers).toBe(2);

    const { sim, rt } = run(fanout().doc, 5);
    expect(rt.qDepth[S.lagKey('q', 'e3')]).toBeUndefined(); // fast subscriber: no lag
    expect(rt.qDepth[S.lagKey('q', 'e4')]).toBe(5 * 1080);
    expect(rt.qDepth[S.lagKey('q', 'e5')]).toBe(5 * 1200);
    expect(sim.queue.q.depth).toBe(5 * 1200);
    // a subscriber with a backlog reads as fast as it can until it catches up
    expect(sim.queue.q.subscribers.find((x) => x.nodeId === 'slow')!.outRate).toBe(120);
  });

  test('a backlog drains once the subscriber is fast enough', () => {
    const d = fanout(2000);
    d.set('off', { down: false, size: 4 });
    const rt = { ...S.EMPTY_RUNTIME, qDepth: { [S.lagKey('q', 'e5')]: 5000 } };
    const s = S.simulate(d.doc, rt);
    const off = s.queue.q.subscribers.find((x) => x.nodeId === 'off')!;
    expect(off.lag).toBe(5000);
    expect(off.outRate).toBe(Math.min(S.capacityPerInstance(d.node('off')), 120 + 5000));
    expect(off.growth).toBeLessThan(0);
    const after = run(d.doc, 3, rt).rt;
    expect(after.qDepth[S.lagKey('q', 'e5')]).toBeUndefined();
  });

  test('at the cap, the oldest messages expire for that subscriber only', () => {
    const rt = { ...S.EMPTY_RUNTIME, qDepth: { [S.lagKey('q', 'e5')]: S.QUEUE_MAX } };
    const s = S.simulate(fanout().doc, rt);
    const off = s.queue.q.subscribers.find((x) => x.nodeId === 'off')!;
    expect(off.full).toBe(true);
    expect(off.growth).toBe(0);
    expect(s.queue.q.full).toBe(true);
    expect(s.errorRate).toBe(0);
    expect(S.stepQueues(fanout().doc, s, rt)![S.lagKey('q', 'e5')]).toBe(S.QUEUE_MAX);
  });

  test('an offline queue rejects new messages and delivers nothing', () => {
    const d = fanout(10000).set('q', { down: true });
    const s = S.simulate(d.doc);
    expect(s.dropFrac.q).toBe(1);
    expect(s.queue.q.inRate).toBe(0);
    expect(s.queue.q.subscribers.every((x) => x.outRate === 0 && x.growth === 0)).toBe(true);
    expect(s.errorRate).toBeGreaterThan(0);
  });

  test('an offline queue with a backlog stops delivering it', () => {
    const d = fanout(10000).set('q', { down: true });
    const s = S.simulate(d.doc, { ...S.EMPTY_RUNTIME, qDepth: { [S.lagKey('q', 'e3')]: 100 } });
    expect(s.queue.q.subscribers[0]).toMatchObject({ lag: 100, outRate: 0, growth: 0 });
  });

  test('pub/sub with no subscribers keeps the messages like a work queue', () => {
    const d = design({ users: 1000 }, ['u', 'users'], ['api', 'app'], ['q', 'queue']).edge('u', 'api').edge('api', 'q', { mode: 'async' });
    const s = S.simulate(d.doc);
    expect(s.queue.q.mode).toBe('work');
    expect(s.queue.q.consumers).toBe(0);
    expect(s.queue.q.growth).toBe(60);
  });
});
