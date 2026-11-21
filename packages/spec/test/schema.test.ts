import { describe, test, expect } from 'vitest';
import {
  COLOR_VALUES, ComponentSpec, ConnectionSpec, DesignSpec, FlowSpec, GroupSpec, KIND_VALUES, LB_ALGORITHM_VALUES,
  NoteSpec, PROTOCOL_VALUES, SIZE_VALUES,
} from '../src/schema';

const minimal = { name: 'Shop', components: [{ name: 'Users', kind: 'users' }] };

describe('enum value lists', () => {
  test('match the editor model', () => {
    expect(KIND_VALUES).toEqual(['users', 'cdn', 'lb', 'gateway', 'app', 'worker', 'cache', 'db', 'store', 'queue', 'ext']);
    expect(SIZE_VALUES).toEqual(['2vCPU', '8vCPU', '16vCPU', '64vCPU', '192vCPU']);
    expect(PROTOCOL_VALUES).toContain('Pub/Sub');
    expect(LB_ALGORITHM_VALUES).toEqual(['round_robin', 'weighted', 'least_connections', 'ip_hash']);
    expect(COLOR_VALUES).toEqual(['blue', 'green', 'orange', 'gray']);
  });
});

describe('DesignSpec defaults', () => {
  test('connections, groups, flows and notes default to empty lists', () => {
    const out = DesignSpec.parse(minimal);
    expect(out.connections).toEqual([]);
    expect(out.groups).toEqual([]);
    expect(out.flows).toEqual([]);
    expect(out.notes).toEqual([]);
    expect(out.users).toBeUndefined();
    expect(out.readPercent).toBeUndefined();
  });

  test('names and texts are trimmed', () => {
    const out = DesignSpec.parse({
      name: '  Shop  ', goal: '  sell  ',
      components: [{ name: '  Users ', kind: 'users', tech: ' Web app ' }],
      notes: [{ text: '  hi  ', near: ' Users ' }],
    });
    expect(out.name).toBe('Shop');
    expect(out.goal).toBe('sell');
    expect(out.components[0].name).toBe('Users');
    expect(out.components[0].tech).toBe('Web app');
    expect(out.notes[0]).toEqual({ text: 'hi', near: 'Users' });
  });
});

describe('DesignSpec limits', () => {
  const bad = (patch: object) => DesignSpec.safeParse({ ...minimal, ...patch }).success;

  test('top-level fields', () => {
    expect(bad({ name: '   ' })).toBe(false);
    expect(bad({ name: 'x'.repeat(121) })).toBe(false);
    expect(bad({ name: 'x'.repeat(120) })).toBe(true);
    expect(bad({ goal: 'x'.repeat(201) })).toBe(false);
    expect(bad({ users: -1 })).toBe(false);
    expect(bad({ users: 1.5 })).toBe(false);
    expect(bad({ users: 0 })).toBe(true);
    expect(bad({ users: 100_000_001 })).toBe(false);
    expect(bad({ dailyActiveUsers: 5_000_000_001 })).toBe(false);
    expect(bad({ readPercent: 101 })).toBe(false);
    expect(bad({ readPercent: 0 })).toBe(true);
    expect(bad({ latencyTargetMs: 0 })).toBe(false);
    expect(bad({ latencyTargetMs: 60_001 })).toBe(false);
  });

  test('component count is 1..200', () => {
    expect(bad({ components: [] })).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => ({ name: `c${i}`, kind: 'app' }));
    expect(bad({ components: many })).toBe(false);
    expect(bad({ components: many.slice(0, 200) })).toBe(true);
  });

  test('list caps', () => {
    const conns = Array.from({ length: 801 }, () => ({ from: 'a', to: 'b' }));
    expect(bad({ connections: conns })).toBe(false);
    const groups = Array.from({ length: 51 }, () => ({ name: 'g', members: ['Users'] }));
    expect(bad({ groups })).toBe(false);
    const notes = Array.from({ length: 51 }, () => ({ text: 'n' }));
    expect(bad({ notes })).toBe(false);
    const flows = Array.from({ length: 51 }, () => ({ name: 'f', steps: ['a', 'b'] }));
    expect(bad({ flows })).toBe(false);
  });
});

describe('ComponentSpec', () => {
  const ok = (c: object) => ComponentSpec.safeParse({ name: 'A', kind: 'app', ...c }).success;

  test('kind, size and names', () => {
    expect(ok({ kind: 'robot' })).toBe(false);
    expect(ok({ size: '4vCPU' })).toBe(false);
    expect(ok({ size: '192vCPU' })).toBe(true);
    expect(ok({ name: '' })).toBe(false);
    expect(ok({ name: 'x'.repeat(61) })).toBe(false);
    expect(ok({ tech: 'x'.repeat(61) })).toBe(false);
  });

  test('replicas and autoscale bounds', () => {
    expect(ok({ replicas: 0 })).toBe(false);
    expect(ok({ replicas: 21 })).toBe(false);
    expect(ok({ replicas: 20 })).toBe(true);
    expect(ok({ autoscale: { mode: 'diagonal' } })).toBe(false);
    expect(ok({ autoscale: { min: 0 } })).toBe(false);
    expect(ok({ autoscale: { max: 51 } })).toBe(false);
    expect(ok({ autoscale: { targetCpu: 29 } })).toBe(false);
    expect(ok({ autoscale: { targetCpu: 96 } })).toBe(false);
    expect(ok({ autoscale: { mode: 'vertical', minSize: '2vCPU', maxSize: '64vCPU', targetCpu: 70 } })).toBe(true);
  });

  test('database, load balancer, measured and cache bounds', () => {
    expect(ok({ database: { shards: 9 } })).toBe(false);
    expect(ok({ database: { readReplicas: 6 } })).toBe(false);
    expect(ok({ database: { shardStrategy: 'random' } })).toBe(false);
    expect(ok({ database: { maxConnections: 9 } })).toBe(false);
    expect(ok({ database: { maxConnections: 100_001 } })).toBe(false);
    expect(ok({ database: { shards: 8, readReplicas: 0, maxConnections: 10_000, shardKey: 'id', shardStrategy: 'geo', syncReplication: true } })).toBe(true);
    expect(ok({ loadBalancer: { algorithm: 'random' } })).toBe(false);
    expect(ok({ loadBalancer: { virtualNodes: 5 } })).toBe(false);
    expect(ok({ loadBalancer: { algorithm: 'ip_hash', virtualNodes: 100 } })).toBe(true);
    expect(ok({ measured: { requestsPerSecond: 0 } })).toBe(false);
    expect(ok({ measured: { latencyMs: 60_001 } })).toBe(false);
    expect(ok({ cache: { ttlSeconds: 0 } })).toBe(false);
    expect(ok({ cache: { ttlSeconds: 86_401 } })).toBe(false);
    expect(ok({ cache: { ttlSeconds: 86_400 } })).toBe(true);
  });
});

describe('ConnectionSpec / GroupSpec / FlowSpec / NoteSpec', () => {
  test('connection bounds', () => {
    const ok = (c: object) => ConnectionSpec.safeParse({ from: 'a', to: 'b', ...c }).success;
    expect(ok({ protocol: 'SOAP' })).toBe(false);
    expect(ok({ carries: 'delete' })).toBe(false);
    expect(ok({ weight: 0 })).toBe(false);
    expect(ok({ weight: 11 })).toBe(false);
    expect(ok({ callsPerRequest: 21 })).toBe(false);
    expect(ok({ retries: 4 })).toBe(false);
    expect(ok({ route: 'x'.repeat(61) })).toBe(false);
    expect(ok({ async: true, protocol: 'gRPC', carries: 'read', weight: 10, route: '/a', callsPerRequest: 20, retries: 3, circuitBreaker: true })).toBe(true);
  });

  test('group needs 1..200 members and a known color', () => {
    expect(GroupSpec.safeParse({ name: 'g', members: [] }).success).toBe(false);
    expect(GroupSpec.safeParse({ name: 'g', members: ['a'], color: 'pink' }).success).toBe(false);
    expect(GroupSpec.safeParse({ name: 'g', members: ['a'], color: 'gray', collapsed: true }).success).toBe(true);
  });

  test('flow needs 2..30 steps', () => {
    expect(FlowSpec.safeParse({ name: 'f', steps: ['a'] }).success).toBe(false);
    expect(FlowSpec.safeParse({ name: 'f', steps: Array(31).fill('a') }).success).toBe(false);
    expect(FlowSpec.safeParse({ name: 'f', steps: ['a', 'b'] }).success).toBe(true);
  });

  test('note text is 1..280 chars', () => {
    expect(NoteSpec.safeParse({ text: '  ' }).success).toBe(false);
    expect(NoteSpec.safeParse({ text: 'x'.repeat(281) }).success).toBe(false);
    expect(NoteSpec.safeParse({ text: 'x'.repeat(280) }).success).toBe(true);
  });
});
