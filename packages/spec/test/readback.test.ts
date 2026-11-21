import { describe, test, expect } from 'vitest';
import type { DesignDoc, DesignNode } from '@syslab/types';
import { autoH, autoV, blankDoc, cacheConfig, dbConfig, lbConfig, makeEdge, makeNode } from '@syslab/sim';
import { buildDesign } from '../src/build';
import { docToSpec } from '../src/readback';
import { DesignSpec } from '../src/schema';
import { c, spec } from './helpers';

/** Node without layout and with configs resolved, so equal settings compare equal. */
const norm = (n: DesignNode) => {
  const { dbc, lbc, cachec, ...rest } = n;
  return {
    ...rest,
    ...(n.kind === 'db' && { db: dbConfig(n) }),
    ...(n.kind === 'lb' && { lb: lbConfig(n) }),
    ...(n.kind === 'cache' && { cache: cacheConfig(n) }),
  };
};

const rich = spec({
  name: 'Rich',
  goal: 'Everything at once',
  users: 40_000,
  dailyActiveUsers: 900_000,
  readPercent: 80,
  latencyTargetMs: 250,
  components: [
    c('Users', 'users', { tech: 'Mobile app' }),
    c('CDN', 'cdn'),
    c('LB', 'lb', { loadBalancer: { algorithm: 'ip_hash', virtualNodes: 100 } }),
    c('LB2', 'lb', { loadBalancer: { algorithm: 'least_connections' } }),
    c('GW', 'gateway', { tech: 'Envoy' }),
    c('API', 'app', { tech: 'Go', size: '64vCPU', autoscale: { min: 3, max: 12, targetCpu: 70 } }),
    c('Search', 'app', { size: '8vCPU', autoscale: { mode: 'vertical', minSize: '8vCPU', maxSize: '192vCPU', targetCpu: 50 } }),
    c('Feed', 'app', { replicas: 4, measured: { requestsPerSecond: 1200, latencyMs: 15 } }),
    c('Redis', 'cache', { cache: { ttlSeconds: 600 }, size: '2vCPU' }),
    c('DB', 'db', { tech: 'MySQL', database: { shards: 3, readReplicas: 2, syncReplication: true, shardKey: 'org_id', shardStrategy: 'geo', maxConnections: 10_000 } }),
    c('Mongo', 'db', { tech: 'MongoDB', measured: { latencyMs: 4 } }),
    c('Q', 'queue', { tech: 'SQS' }),
    c('W', 'worker', { offline: true }),
    c('Stripe', 'ext', { measured: { requestsPerSecond: 100 } }),
    c('S3', 'store'),
  ],
  connections: [
    { from: 'Users', to: 'CDN' },
    { from: 'Users', to: 'LB' },
    { from: 'LB', to: 'GW' },
    { from: 'GW', to: 'API', route: '/api/*', weight: 3 },
    { from: 'GW', to: 'LB2', route: '/search/*' },
    { from: 'LB2', to: 'Search' },
    { from: 'GW', to: 'Feed', protocol: 'gRPC' },
    { from: 'API', to: 'Redis' },
    { from: 'Redis', to: 'DB', carries: 'read' },
    { from: 'API', to: 'DB', carries: 'write', retries: 2, circuitBreaker: true },
    { from: 'Feed', to: 'Mongo', callsPerRequest: 3 },
    { from: 'API', to: 'Q', async: true },
    { from: 'Q', to: 'W', async: true, protocol: 'TCP' },
    { from: 'W', to: 'Stripe', protocol: 'Webhook' },
    { from: 'CDN', to: 'S3' },
  ],
  groups: [
    { name: 'Edge', members: ['CDN', 'LB'], color: 'gray' },
    { name: 'Services', members: ['GW', 'API', 'Search', 'Feed', 'LB2'], collapsed: true },
    { name: 'Data', members: ['Redis', 'DB', 'Mongo'] },
  ],
  flows: [{ name: 'Checkout', steps: ['Users', 'LB', 'GW', 'API', 'DB'] }],
  notes: [{ text: 'Hot path', near: 'API' }, { text: 'Free note' }],
});

describe('docToSpec: round trip', () => {
  const first = buildDesign(rich);
  const back = docToSpec('Rich', first.doc);
  const second = buildDesign(back);

  test('the spec read back is valid', () => {
    expect(DesignSpec.safeParse(back).success).toBe(true);
  });

  test('nodes keep ids, labels, settings and positions', () => {
    expect(second.doc.nodes.map(norm)).toEqual(first.doc.nodes.map(norm));
  });

  test('edges, groups, flows, requirements and users are preserved', () => {
    expect(second.doc.edges).toEqual(first.doc.edges);
    expect(second.doc.groups).toEqual(first.doc.groups);
    expect(second.doc.flows).toEqual(first.doc.flows);
    expect(second.doc.requirements).toEqual(first.doc.requirements);
    expect(second.doc.users).toBe(40_000);
  });

  test('notes keep their text (positions are re-laid out)', () => {
    expect(second.doc.notes.map((t) => t.text)).toEqual(['Hot path', 'Free note']);
  });

  test('a second read back is stable', () => {
    expect(docToSpec('Rich', second.doc)).toEqual(back);
  });

  test('what the spec looks like', () => {
    expect(back).toMatchObject({ name: 'Rich', goal: 'Everything at once', users: 40_000, dailyActiveUsers: 900_000, readPercent: 80, latencyTargetMs: 250 });
    const by = Object.fromEntries(back.components.map((x) => [x.name, x]));
    expect(by.API.autoscale).toEqual({ mode: 'horizontal', min: 3, max: 12, targetCpu: 70 });
    expect(by.Search.autoscale).toEqual({ mode: 'vertical', minSize: '8vCPU', maxSize: '192vCPU', targetCpu: 50 });
    expect(by.Feed.replicas).toBe(4);
    expect(by.Feed.measured).toEqual({ requestsPerSecond: 1200, latencyMs: 15 });
    expect(by.Mongo.measured).toEqual({ latencyMs: 4 });
    expect(by.Stripe.measured).toEqual({ requestsPerSecond: 100 });
    expect(by.LB.loadBalancer).toEqual({ algorithm: 'ip_hash', virtualNodes: 100 });
    expect(by.LB2.loadBalancer).toEqual({ algorithm: 'least_connections' });
    expect(by.DB.database).toEqual({ shards: 3, readReplicas: 2, syncReplication: true, shardKey: 'org_id', shardStrategy: 'geo', maxConnections: 10_000 });
    expect(by.Mongo.database).not.toHaveProperty('maxConnections');
    expect(by.Redis.cache).toEqual({ ttlSeconds: 600 });
    expect(by.Redis.size).toBe('2vCPU');
    expect(by.W.offline).toBe(true);
    expect(by.CDN).toEqual({ name: 'CDN', kind: 'cdn', tech: 'Cloudflare' }); // fixed-size kinds have no size
    const conn = (f: string, t: string) => back.connections!.find((x) => x.from === f && x.to === t);
    expect(conn('Users', 'CDN')).toEqual({ from: 'Users', to: 'CDN', protocol: 'REST' });
    expect(conn('GW', 'API')).toEqual({ from: 'GW', to: 'API', protocol: 'REST', weight: 3, route: '/api/*' });
    expect(conn('API', 'DB')).toEqual({ from: 'API', to: 'DB', protocol: 'REST', carries: 'write', retries: 2, circuitBreaker: true });
    expect(conn('Feed', 'Mongo')).toMatchObject({ callsPerRequest: 3 });
    expect(conn('Q', 'W')).toEqual({ from: 'Q', to: 'W', async: true, protocol: 'TCP' });
    expect(back.groups).toEqual([
      { name: 'Edge', color: 'gray', members: ['CDN', 'LB'] },
      { name: 'Services', color: 'green', members: ['LB2', 'GW', 'API', 'Search', 'Feed'], collapsed: true },
      { name: 'Data', color: 'orange', members: ['Redis', 'DB', 'Mongo'] },
    ].map((g) => ({ ...g, members: expect.arrayContaining(g.members) })));
    expect(back.notes).toEqual([{ text: 'Hot path' }, { text: 'Free note' }]);
  });
});

describe('docToSpec: documents edited by hand in the editor', () => {
  const N = (id: string, kind: DesignNode['kind'], label: string, over: Partial<DesignNode> = {}) => makeNode(id, kind, 0, 0, label, over);

  function doc(): DesignDoc {
    return blankDoc({
      nodes: [
        N('u', 'users', 'Users', { x: 100, y: 100 }),
        N('a', 'app', 'API', { x: 300, y: 100 }),
        N('b', 'app', 'api', { x: 500, y: 100 }), // same name, other case
        N('c', 'app', 'API', { x: 700, y: 100 }),
        N('d', 'db', '   ', { x: 900, y: 100 }), // blank label → kind name
        N('big', 'app', 'Big', { size: 9 }),
        N('tiny', 'app', 'Tiny', { size: -3 }),
        N('m', 'app', 'NoMeasure', { measured: {}, tech: '' }),
        N('lb', 'lb', 'RR', { lbc: { algo: 'wrr', vnodes: 100 } }),
      ],
      edges: [
        makeEdge('e1', 'u', 'a', { weight: 0 }),
        makeEdge('e2', 'a', 'ghost'),
        makeEdge('e3', 'a', 'd', { weight: 1 }),
      ],
      groups: [
        { id: 'g1', label: 'Front', color: 'blue', x: 50, y: 50, w: 300, h: 100 },
        { id: 'g2', label: 'Empty', color: 'green', x: 5000, y: 5000, w: 10, h: 10 },
      ],
      flows: [
        { id: 'f1', name: 'Short', steps: ['u'] },
        { id: 'f2', name: 'Broken', steps: ['u', 'ghost'] },
        { id: 'f3', name: 'Ok', steps: ['u', 'a', 'd'] },
      ],
      notes: [{ id: 't1', text: 'hello', x: 1, y: 2 }],
    });
  }

  const out = docToSpec('Hand made', doc());

  test('duplicate labels get numbered, blank labels use the kind name', () => {
    expect(out.components.slice(0, 5).map((x) => x.name)).toEqual(['Users', 'API', 'api (2)', 'API (3)', 'Database']);
  });

  test('blank goal is left out', () => {
    expect(out.goal).toBeUndefined();
    expect(out.dailyActiveUsers).toBe(120_000);
  });

  test('sizes are clamped to the known range', () => {
    const by = Object.fromEntries(out.components.map((x) => [x.name, x]));
    expect(by.Big.size).toBe('192vCPU');
    expect(by.Tiny.size).toBe('2vCPU');
    expect(by.NoMeasure).not.toHaveProperty('measured');
    expect(by.NoMeasure.tech).toBeUndefined(); // blank tech is left out
    expect(by.RR.loadBalancer).toEqual({ algorithm: 'weighted' });
    expect(by.Database.database).toEqual({ shards: 1, readReplicas: 0, syncReplication: false, shardKey: 'user_id', shardStrategy: 'hash' });
  });

  test('connections to missing nodes are dropped; weight 0 counts as 1', () => {
    expect(out.connections).toEqual([
      { from: 'Users', to: 'API', protocol: 'REST' },
      { from: 'API', to: 'Database', protocol: 'REST' },
    ]);
  });

  test('groups are membership by position; empty groups are dropped', () => {
    expect(out.groups).toEqual([{ name: 'Front', color: 'blue', members: ['Users', 'API'] }]);
  });

  test('flows with fewer than two steps or missing steps are dropped', () => {
    expect(out.flows).toEqual([{ name: 'Ok', steps: ['Users', 'API', 'Database'] }]);
    expect(out.notes).toEqual([{ text: 'hello' }]);
  });

  test('the read-back spec builds', () => {
    const { doc: rebuilt } = buildDesign(out);
    expect(rebuilt.nodes).toHaveLength(9);
    expect(rebuilt.edges).toHaveLength(2);
  });

  test('autoscale readback handles partial autoscale objects', () => {
    const d = blankDoc({ nodes: [N('h', 'worker', 'H', { autoscale: autoH(2, 6) }), N('v', 'app', 'V', { autoscale: autoV(0, 3) }), N('x', 'cache', 'X', { autoscale: autoH(2, 6) })] });
    const s = docToSpec('A', d);
    expect(s.components[0].autoscale).toEqual({ mode: 'horizontal', min: 2, max: 6, targetCpu: 60 });
    expect(s.components[1].autoscale).toEqual({ mode: 'vertical', minSize: '2vCPU', maxSize: '64vCPU', targetCpu: 60 });
    expect(s.components[2]).not.toHaveProperty('autoscale'); // caches cannot autoscale
  });
});
