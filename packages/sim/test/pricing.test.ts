import { describe, expect, test } from 'vitest';
import { S, design } from './helpers';

const h = S.HOURS_PER_MONTH;
const node = (kind: string, over: Record<string, unknown> = {}) => S.makeNode('n', kind, 0, 0, 'N', over);
const input = (p: Record<string, number> = {}) => ({ rps: 0, sizeIdx: 2, reps: 1, read: 0.9, respKb: 10, assetKb: 100, storageGb: 500, ...p });
const price = (kind: string, over: Record<string, unknown> = {}, p: Record<string, number> = {}) => S.priceNode(node(kind, over), input(p));

describe('tiered pricing', () => {
  test('fills each tier in order', () => {
    expect(S.tiered(0, S.EGRESS_TIERS)).toBe(0);
    expect(S.tiered(100, S.EGRESS_TIERS)).toBe(0); // free tier
    expect(S.tiered(1100, S.EGRESS_TIERS)).toBeCloseTo(1000 * 0.09, 9);
    expect(S.tiered(10_340, S.EGRESS_TIERS)).toBeCloseTo(10_240 * 0.09, 9);
    expect(S.tiered(-5, S.EGRESS_TIERS)).toBe(0);
    // far past every tier: the last one is open-ended
    const huge = S.tiered(10_000_000, S.CLOUDFRONT_TIERS);
    expect(huge).toBeGreaterThan(S.tiered(5_000_000, S.CLOUDFRONT_TIERS));
  });
});

describe('priceNode', () => {
  test('users cost nothing', () => {
    expect(price('users')).toEqual({ monthly: 0, category: 'network', detail: '' });
  });

  test('app and worker: EC2 per instance, size clamped to the table', () => {
    expect(price('app', {}, { reps: 3 })).toEqual({ monthly: 0.768 * h * 3, category: 'compute', detail: 'EC2 3 × m6i.4xlarge' });
    expect(price('worker', {}, { sizeIdx: 99 }).detail).toBe('EC2 1 × m7i.48xlarge');
    expect(price('worker', {}, { sizeIdx: -1 }).detail).toBe('EC2 1 × c6i.large');
  });

  test('caches: ElastiCache, Valkey 20% cheaper', () => {
    expect(price('cache', { tech: 'Redis' }).monthly).toBeCloseTo(0.768 * 1.55 * h, 9);
    expect(price('cache', { tech: 'Valkey' }).monthly).toBeCloseTo(0.768 * 1.24 * h, 9);
    expect(price('cache').category).toBe('cache');
  });

  test('databases: RDS, DocumentDB, self-managed, DynamoDB on demand', () => {
    const per = (premium: number, gb: number) => 0.768 * premium * h + 500 * gb;
    expect(price('db', { tech: 'Postgres' }).monthly).toBeCloseTo(per(1.78, 0.115), 9);
    expect(price('db', { tech: 'MySQL', dbc: { shards: 2, replicas: 2 } }).monthly).toBeCloseTo(per(1.78, 0.115) * 6, 9);
    expect(price('db', { tech: 'MongoDB' }).detail).toBe('DocumentDB 1 × m6i.4xlarge + 500 GB each');
    expect(price('db', { tech: 'Cassandra' }).monthly).toBeCloseTo(per(1, 0.08), 9);
    const dyn = price('db', { tech: 'DynamoDB' }, { rps: 1000, read: 0.9 });
    const writes = (100 * S.SECONDS_PER_MONTH) / 1e6, reads = (900 * S.SECONDS_PER_MONTH) / 1e6;
    expect(dyn.monthly).toBeCloseTo(writes * 1.25 + reads * 0.25 + 500 * 0.25, 6);
    expect(dyn.detail).toMatch(/^DynamoDB on-demand · \d+M writes \+ \d+M reads$/);
  });

  test('S3: storage plus GET and PUT requests', () => {
    const s = price('store', {}, { rps: 100, read: 0.5 });
    const k = (50 * S.SECONDS_PER_MONTH) / 1000;
    expect(s.monthly).toBeCloseTo(500 * 0.023 + k * 0.0004 + k * 0.005, 6);
    expect(s.category).toBe('storage');
  });

  test('CDN: tiered data out plus requests', () => {
    const c = price('cdn', {}, { rps: 10, assetKb: 100 });
    const gb = (10 * S.SECONDS_PER_MONTH * 100) / 1_048_576;
    expect(c.monthly).toBeCloseTo(S.tiered(gb, S.CLOUDFRONT_TIERS) + (10 * S.SECONDS_PER_MONTH / 10_000) * 0.01, 6);
    expect(c.detail).toMatch(/^CloudFront [\d,]+ GB\/month out \+ requests$/);
  });

  test('load balancers: an Nginx/HAProxy pair or an ALB with LCUs', () => {
    expect(price('lb', { tech: 'Nginx' }).monthly).toBeCloseTo(0.085 * h * 2, 9);
    expect(price('lb', { tech: 'HAProxy' }).detail).toBe('EC2 2 × c6i.large (HA pair)');
    expect(price('lb', { tech: 'AWS ALB' }, { rps: 0 }).monthly).toBeCloseTo((0.0225 + 0.008) * h, 9); // at least 1 LCU
    const busy = price('lb', { tech: 'AWS ALB' }, { rps: 5000, respKb: 10 });
    expect(busy.detail).toBe('ALB + 172 LCU'); // 5k rps × 10 KB ≈ 172 GB/h processed
  });

  test('gateways: API Gateway per million requests, others self-hosted', () => {
    const g = price('gateway', { tech: 'AWS API Gateway' }, { rps: 100 });
    expect(g.monthly).toBeCloseTo((100 * S.SECONDS_PER_MONTH / 1e6) * 1.0, 6);
    expect(price('gateway', { tech: 'Kong' })).toEqual({ monthly: 0.096 * h * 2, category: 'network', detail: 'EC2 2 × m6i.large (self-hosted, HA)' });
  });

  test('queues: SQS requests, BullMQ on ElastiCache, MSK brokers, self-hosted brokers', () => {
    expect(price('queue', { tech: 'SQS' }, { rps: 100 }).monthly).toBeCloseTo((100 * S.SECONDS_PER_MONTH * 3 / 1e6) * 0.4, 6);
    expect(price('queue', { tech: 'BullMQ (Redis)' }).monthly).toBeCloseTo(0.149 * h, 9);
    expect(price('queue', { tech: 'Kafka' }, { rps: 100 }).detail).toBe('MSK 3 × kafka.m5.large');
    expect(price('queue', { tech: 'Kafka' }, { rps: 10_000, respKb: 10 }).detail).toBe('MSK 4 × kafka.m5.large'); // ~98 MB/s
    expect(price('queue', { tech: 'RabbitMQ', queuec: { mode: 'pubsub' } }).detail).toBe('MSK 3 × kafka.m5.large');
    expect(price('queue', { tech: 'RabbitMQ' }).detail).toBe('EC2 3 × m6i.large (self-hosted cluster)');
  });

  test('third parties: SES and SMS per message, payments on revenue, others unknown', () => {
    expect(price('ext', { tech: 'Email (SES)' }, { rps: 1 }).monthly).toBeCloseTo((S.SECONDS_PER_MONTH / 1000) * 0.1, 6);
    expect(price('ext', { tech: 'SMS provider' }, { rps: 1 }).monthly).toBeCloseTo(S.SECONDS_PER_MONTH * 0.00581, 6);
    expect(price('ext', { tech: 'Payment gateway' })).toMatchObject({ monthly: 0, detail: 'Billed on revenue (Stripe: 2.9% + 30¢ per charge)' });
    expect(price('ext', { tech: 'Third-party API' })).toMatchObject({ monthly: 0, detail: 'Priced by the provider' });
  });

  test('an unknown kind costs nothing', () => {
    expect(S.priceNode({ ...node('app'), kind: 'mystery' }, input())).toEqual({ monthly: 0, category: 'compute', detail: '' });
  });
});

describe('sizes and egress', () => {
  test('sizes come from the requirements, with defaults', () => {
    expect(S.sizesOf({ requirements: { ...S.DEFAULT_REQUIREMENTS } })).toEqual({ respKb: 10, assetKb: 100, storageGb: 500 });
    expect(S.sizesOf({ requirements: { ...S.DEFAULT_REQUIREMENTS, respKb: 2, assetKb: 800, storageGb: 50 } })).toEqual({ respKb: 2, assetKb: 800, storageGb: 50 });
    expect(S.sizesOf({ requirements: { ...S.DEFAULT_REQUIREMENTS, respKb: 0, assetKb: -1 } })).toMatchObject({ respKb: 10, assetKb: 100 });
    expect(S.sizesOf({})).toEqual({ respKb: 10, assetKb: 100, storageGb: 500 });
  });

  test('only responses served by the origin pay internet egress (the CDN has its own price)', () => {
    const d = design({ users: 10000 }, ['u', 'users'], ['cdn', 'cdn'], ['api', 'app', { size: 4 }]).edge('u', 'cdn', { weight: 3 }).edge('u', 'api');
    const s = S.simulate(d.doc);
    const gb = (150 * S.SECONDS_PER_MONTH * 10) / 1_048_576; // 600 rps, a quarter to the API
    expect(s.egress.gb).toBeCloseTo(gb, 6);
    expect(S.egressCost(0, 10)).toEqual({ monthly: 0, gb: 0 });
  });
});

describe('costBreakdown', () => {
  const doc = () => design({ users: 20000 },
    ['u', 'users'], ['api', 'app', { size: 4 }], ['idle', 'app', { size: 3 }], ['w', 'worker', { size: 2 }], ['db', 'db', { size: 3, tech: 'Postgres' }],
    ['dyn', 'db', { tech: 'DynamoDB' }], ['c', 'cache'], ['q', 'queue', { tech: 'SQS' }], ['x', 'ext', { tech: 'Payment gateway' }])
    .edge('u', 'api').edge('api', 'db', { calls: 1 }).edge('api', 'dyn', { calls: 1 }).edge('api', 'c', { calls: 1 }).edge('api', 'idle', { calls: 1 })
    .edge('api', 'q', { mode: 'async', calls: 1 }).edge('q', 'w', { mode: 'async' }).edge('api', 'x', { calls: 1 });

  test('items sorted by cost, categories add up, egress listed', () => {
    const d = doc();
    const s = S.simulate(d.doc);
    const b = S.costBreakdown(d.doc, s);
    expect(b.source).toBe(S.PRICING_SOURCE);
    expect(b.total).toBeCloseTo(s.cost, 6);
    expect(b.items.map((i) => i.monthly)).toEqual([...b.items.map((i) => i.monthly)].sort((x, y) => y - x));
    expect(b.items.some((i) => i.id === 'egress' && i.kind === 'egress')).toBe(true);
    expect(b.byCategory.reduce((t, c) => t + c.monthly, 0)).toBeCloseTo(b.total, 6);
    expect(b.byCategory.every((c) => c.monthly > 0)).toBe(true);
    expect(b.items.find((i) => i.id === 'x')).toMatchObject({ category: 'third-party', monthly: 0 });
  });

  test('suggests Spot for workers, a Savings Plan, reserved databases, Graviton and right-sizing', () => {
    const d = doc();
    const s = S.simulate(d.doc);
    const b = S.costBreakdown(d.doc, s);
    const keys = b.savings.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['spot', 'plan', 'ri', 'graviton']));
    const spot = b.savings.find((x) => x.key === 'spot')!;
    expect(spot.monthly).toBeCloseTo(s.nodeCost.w * 0.65, 6);
    const ri = b.savings.find((x) => x.key === 'ri')!;
    expect(ri.monthly).toBeCloseTo(s.nodeCost.db * 0.35, 6); // DynamoDB on demand is not reserved
    // only machines with traffic and under 25% busy are offered a smaller size
    expect(keys).toContain('size:idle');
    for (const k of keys.filter((x) => x.startsWith('size:'))) {
      const id = k.slice(5);
      expect(s.load[id]).toBeGreaterThan(0);
      expect(s.load[id]).toBeLessThan(0.25);
    }
    expect(b.savings.map((x) => x.monthly)).toEqual([...b.savings.map((x) => x.monthly)].sort((x, y) => y - x));
  });

  test('no traffic: no right-sizing advice, and nothing to save on an empty design', () => {
    const d = doc();
    d.doc.users = 0;
    const b = S.costBreakdown(d.doc, S.simulate(d.doc));
    expect(b.savings.some((x) => x.key.startsWith('size:'))).toBe(false);
    const empty = S.blankDoc({ nodes: [S.makeNode('u', 'users', 0, 0, 'U')] });
    expect(S.costBreakdown(empty, S.simulate(empty))).toMatchObject({ total: 0, items: [], byCategory: [], savings: [] });
  });

  test('missing simulation details fall back to safe values', () => {
    const d = S.blankDoc({ nodes: [S.makeNode('a', 'app', 0, 0, 'A', { size: 0 })] });
    const b = S.costBreakdown(d, { nodeCost: {}, nodeCostDetail: {}, egress: { monthly: 0, gb: 0 }, load: {}, sizeIdx: {}, reps: {} });
    expect(b.items).toEqual([{ id: 'a', label: 'A', kind: 'app', category: 'compute', monthly: 0, detail: '' }]);
  });
});
