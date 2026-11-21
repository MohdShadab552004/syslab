import { describe, test, expect } from 'vitest';
import { DEFAULT_AUTOSCALE, DEFAULT_REQUIREMENTS } from '@syslab/sim';
import { SpecError, buildDesign } from '../src/build';
import { c, issuesOf, nodeOf, spec } from './helpers';

describe('buildDesign: happy path', () => {
  const res = buildDesign({
    name: '  Shop  ',
    goal: 'Sell things',
    users: 5000,
    dailyActiveUsers: 80_000,
    readPercent: 70,
    latencyTargetMs: 150,
    components: [
      c('Users', 'users'),
      c('Edge LB', 'lb'),
      c('Order Service', 'app', { tech: 'Go', size: '64vCPU' }),
      c('Orders DB', 'db'),
    ],
    connections: [
      { from: 'Users', to: 'Edge LB' },
      { from: 'edge lb', to: 'ORDER SERVICE' }, // names are case-insensitive
      { from: 'Order Service', to: 'Orders DB' },
    ],
  });

  test('returns the trimmed name, a doc and no warnings', () => {
    expect(res.name).toBe('Shop');
    expect(res.warnings).toEqual([]);
    expect(res.doc.schemaVersion).toBe(1);
  });

  test('ids are n_<slug> for nodes and e_N for edges', () => {
    expect(res.doc.nodes.map((n) => n.id)).toEqual(['n_users', 'n_edge-lb', 'n_order-service', 'n_orders-db']);
    expect(res.doc.edges.map((e) => [e.id, e.from, e.to])).toEqual([
      ['e_1', 'n_users', 'n_edge-lb'],
      ['e_2', 'n_edge-lb', 'n_order-service'],
      ['e_3', 'n_order-service', 'n_orders-db'],
    ]);
  });

  test('labels keep the spec name; tech and size are mapped', () => {
    const svc = nodeOf(res.doc, 'Order Service');
    expect(svc.kind).toBe('app');
    expect(svc.tech).toBe('Go');
    expect(svc.size).toBe(3);
    // defaults from the editor factory when not given
    expect(nodeOf(res.doc, 'Orders DB').tech).toBe('Postgres');
    expect(nodeOf(res.doc, 'Orders DB').size).toBe(2);
  });

  test('edges get sync REST defaults', () => {
    expect(res.doc.edges[0]).toMatchObject({ mode: 'sync', proto: 'REST', op: 'both', weight: 1, route: '' });
    expect(res.doc.edges[0]).not.toHaveProperty('calls');
    expect(res.doc.edges[0]).not.toHaveProperty('retries');
    expect(res.doc.edges[0]).not.toHaveProperty('breaker');
  });

  test('requirements and users', () => {
    expect(res.doc.users).toBe(5000);
    expect(res.doc.requirements).toEqual({ ...DEFAULT_REQUIREMENTS, goal: 'Sell things', dau: 80_000, read: 70, slo: 150 });
  });

  test('nodes get positions', () => {
    for (const n of res.doc.nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.y).toBeGreaterThan(0);
    }
  });
});

describe('buildDesign: users and requirements defaults', () => {
  test('nothing set: 12,000 users and default requirements', () => {
    const { doc } = buildDesign(spec({}));
    expect(doc.users).toBe(12_000);
    expect(doc.requirements).toEqual({ ...DEFAULT_REQUIREMENTS, goal: '' });
  });

  test('dailyActiveUsers sets users to the 10% peak', () => {
    const { doc } = buildDesign(spec({ dailyActiveUsers: 50_005 }));
    expect(doc.users).toBe(5001);
    expect(doc.requirements.dau).toBe(50_005);
  });

  test('dailyActiveUsers 0 means zero users, explicit users win', () => {
    expect(buildDesign(spec({ dailyActiveUsers: 0 })).doc.users).toBe(0);
    expect(buildDesign(spec({ dailyActiveUsers: 50_000, users: 7 })).doc.users).toBe(7);
  });
});

describe('buildDesign: ids', () => {
  test('names with the same slug get numbered ids; symbol-only names slug to x', () => {
    const { doc } = buildDesign(spec({ components: [c('Users', 'users'), c('API', 'app'), c('API!', 'app'), c('Api?', 'app'), c('!!!', 'app'), c('???', 'app')] }));
    expect(doc.nodes.map((n) => n.id)).toEqual(['n_users', 'n_api', 'n_api_2', 'n_api_3', 'n_x', 'n_x_2']);
  });

  test('long names are cut to 24 chars in the slug', () => {
    const { doc } = buildDesign(spec({ components: [c('Users', 'users'), c('Notification delivery service', 'app')] }));
    expect(doc.nodes[1].id).toBe('n_notification-delivery-se');
  });
});

describe('buildDesign: component options', () => {
  const build = (...comps: ReturnType<typeof c>[]) => buildDesign(spec({ components: [c('Users', 'users'), ...comps] }));

  test('every size maps to its index', () => {
    const sizes = ['2vCPU', '8vCPU', '16vCPU', '64vCPU', '192vCPU'] as const;
    const { doc } = build(...sizes.map((s) => c(`App ${s}`, 'app', { size: s })));
    expect(sizes.map((s) => nodeOf(doc, `App ${s}`).size)).toEqual([0, 1, 2, 3, 4]);
  });

  test('size on a fixed-capacity kind is ignored with a warning', () => {
    const { doc, warnings } = build(c('Queue', 'queue', { size: '64vCPU' }));
    expect(warnings).toContain('size on "Queue" was ignored: Queue has a fixed capacity.');
    expect(nodeOf(doc, 'Queue').size).toBe(2);
  });

  test('replicas', () => {
    expect(nodeOf(build(c('API', 'app', { replicas: 3 })).doc, 'API').replicas).toBe(3);
    expect(nodeOf(build(c('API', 'app')).doc, 'API').replicas).toBe(1);
  });

  test('horizontal autoscale with explicit min, max and target', () => {
    const { doc, warnings } = build(c('API', 'app', { autoscale: { mode: 'horizontal', min: 3, max: 12, targetCpu: 70 } }));
    expect(nodeOf(doc, 'API').autoscale).toEqual({ ...DEFAULT_AUTOSCALE, on: true, mode: 'h', min: 3, max: 12, target: 70 });
    expect(warnings).toEqual([]);
  });

  test('horizontal autoscale defaults (mode omitted)', () => {
    const { doc } = build(c('W', 'worker', { autoscale: {} }));
    expect(nodeOf(doc, 'W').autoscale).toEqual({ ...DEFAULT_AUTOSCALE, on: true, mode: 'h', min: 2, max: 10, target: 60 });
  });

  test('horizontal autoscale: max defaults to at least min', () => {
    const { doc } = build(c('API', 'app', { autoscale: { min: 20 } }));
    expect(nodeOf(doc, 'API').autoscale).toMatchObject({ min: 20, max: 20 });
  });

  test('horizontal autoscale: min > max is swapped with a warning', () => {
    const { doc, warnings } = build(c('API', 'app', { autoscale: { min: 9, max: 4 } }));
    expect(nodeOf(doc, 'API').autoscale).toMatchObject({ min: 4, max: 9 });
    expect(warnings).toContain('autoscale min > max on "API"; swapped them.');
  });

  test('vertical autoscale with sizes (swapped if reversed) and defaults', () => {
    const a = build(c('API', 'app', { autoscale: { mode: 'vertical', minSize: '192vCPU', maxSize: '8vCPU', targetCpu: 80 } }));
    expect(nodeOf(a.doc, 'API').autoscale).toEqual({ ...DEFAULT_AUTOSCALE, on: true, mode: 'v', minSize: 1, maxSize: 4, target: 80 });
    const b = build(c('API', 'app', { autoscale: { mode: 'vertical' } }));
    expect(nodeOf(b.doc, 'API').autoscale).toEqual({ ...DEFAULT_AUTOSCALE, on: true, mode: 'v', minSize: DEFAULT_AUTOSCALE.minSize, maxSize: DEFAULT_AUTOSCALE.maxSize, target: 60 });
    const v = build(c('API', 'app', { autoscale: { mode: 'vertical', minSize: '2vCPU' } }));
    expect(nodeOf(v.doc, 'API').autoscale).toMatchObject({ minSize: 0, maxSize: 4 });
  });

  test('autoscale on a kind that cannot scale is ignored', () => {
    const { doc, warnings } = build(c('Redis', 'cache', { autoscale: { min: 2, max: 4 } }));
    expect(warnings).toContain('autoscale on "Redis" was ignored: only app and worker can autoscale.');
    expect(nodeOf(doc, 'Redis').autoscale.on).toBe(false);
  });

  test('database settings, including maxConnections', () => {
    const { doc } = build(c('DB', 'db', { database: { shards: 4, readReplicas: 2, syncReplication: true, shardKey: 'tenant_id', shardStrategy: 'range', maxConnections: 10_000 } }));
    expect(nodeOf(doc, 'DB').dbc).toEqual({ shards: 4, replicas: 2, sync: true, shardKey: 'tenant_id', strategy: 'range', maxConn: 10_000 });
  });

  test('database settings: zero / false values are kept, missing ones are left out', () => {
    const { doc } = build(c('DB', 'db', { database: { readReplicas: 0, syncReplication: false } }), c('DB2', 'db', { database: {} }));
    expect(nodeOf(doc, 'DB').dbc).toEqual({ replicas: 0, sync: false });
    expect(nodeOf(doc, 'DB2').dbc).toEqual({});
  });

  test('database settings on a non-db are ignored', () => {
    const { doc, warnings } = build(c('API', 'app', { database: { shards: 2 } }));
    expect(warnings).toContain('database settings on "API" were ignored: it is not a db.');
    expect(nodeOf(doc, 'API').dbc).toBeUndefined();
  });

  test('every load balancer algorithm maps to the editor key, vnodes kept', () => {
    const algos = { round_robin: 'rr', weighted: 'wrr', least_connections: 'lc', ip_hash: 'hash' } as const;
    const { doc } = build(...Object.keys(algos).map((a) => c(`LB ${a}`, 'lb', { loadBalancer: { algorithm: a as keyof typeof algos } })));
    for (const [a, k] of Object.entries(algos)) expect(nodeOf(doc, `LB ${a}`).lbc).toEqual({ algo: k });
    const h = build(c('LB', 'lb', { loadBalancer: { algorithm: 'ip_hash', virtualNodes: 100 } }), c('LB2', 'lb', { loadBalancer: { virtualNodes: 1 } }), c('LB3', 'lb', { loadBalancer: {} }));
    expect(nodeOf(h.doc, 'LB').lbc).toEqual({ algo: 'hash', vnodes: 100 });
    expect(nodeOf(h.doc, 'LB2').lbc).toEqual({ vnodes: 1 });
    expect(nodeOf(h.doc, 'LB3').lbc).toEqual({});
  });

  test('loadBalancer on a non-lb is ignored', () => {
    const { doc, warnings } = build(c('GW', 'gateway', { loadBalancer: { algorithm: 'weighted' } }));
    expect(warnings).toContain('loadBalancer settings on "GW" were ignored: it is not an lb.');
    expect(nodeOf(doc, 'GW').lbc).toBeUndefined();
  });

  test('cache ttl, empty cache settings, and cache settings on a non-cache', () => {
    const { doc, warnings } = build(c('Redis', 'cache', { cache: { ttlSeconds: 300 } }), c('Memo', 'cache', { cache: {} }), c('DB', 'db', { cache: { ttlSeconds: 5 } }));
    expect(nodeOf(doc, 'Redis').cachec).toEqual({ ttl: 300 });
    expect(nodeOf(doc, 'Memo').cachec).toBeUndefined();
    expect(nodeOf(doc, 'DB').cachec).toBeUndefined();
    expect(warnings).toEqual(['cache settings on "DB" were ignored: it is not a cache.']);
  });

  test('measured numbers: both, one of them, none, and on users', () => {
    const { doc, warnings } = buildDesign(spec({
      components: [
        c('Users', 'users', { measured: { requestsPerSecond: 5 } }),
        c('A', 'app', { measured: { requestsPerSecond: 900, latencyMs: 12 } }),
        c('B', 'app', { measured: { latencyMs: 7 } }),
        c('C', 'app', { measured: { requestsPerSecond: 50 } }),
        c('D', 'app', { measured: {} }),
      ],
    }));
    expect(nodeOf(doc, 'A').measured).toEqual({ rps: 900, ms: 12 });
    expect(nodeOf(doc, 'B').measured).toEqual({ ms: 7 });
    expect(nodeOf(doc, 'C').measured).toEqual({ rps: 50 });
    expect(nodeOf(doc, 'D').measured).toBeUndefined();
    expect(nodeOf(doc, 'Users').measured).toBeUndefined();
    expect(warnings).toEqual(['measured numbers on "Users" were ignored: users have no capacity.']);
  });

  test('offline', () => {
    const { doc } = build(c('DB', 'db', { offline: true }), c('DB2', 'db', { offline: false }));
    expect(nodeOf(doc, 'DB').down).toBe(true);
    expect(nodeOf(doc, 'DB2').down).toBe(false);
  });
});

describe('buildDesign: connection options', () => {
  const base = [c('Users', 'users'), c('GW', 'gateway'), c('API', 'app'), c('Q', 'queue'), c('W', 'worker'), c('DB', 'db'), c('LB', 'lb')];

  test('async defaults to Pub/Sub; explicit protocol, carries, weight and route are kept', () => {
    const { doc, warnings } = buildDesign(spec({
      components: base,
      connections: [
        { from: 'API', to: 'Q', async: true },
        { from: 'Q', to: 'W', async: true, protocol: 'TCP' },
        { from: 'API', to: 'DB', carries: 'read', weight: 3, protocol: 'gRPC' },
        { from: 'GW', to: 'API', route: '/orders/*' },
      ],
    }));
    expect(doc.edges[0]).toMatchObject({ mode: 'async', proto: 'Pub/Sub' });
    expect(doc.edges[1]).toMatchObject({ mode: 'async', proto: 'TCP' });
    expect(doc.edges[2]).toMatchObject({ mode: 'sync', proto: 'gRPC', op: 'read', weight: 3 });
    expect(doc.edges[3]).toMatchObject({ route: '/orders/*' });
    expect(warnings).toEqual([]);
  });

  test('callsPerRequest, retries and circuitBreaker', () => {
    const { doc, warnings } = buildDesign(spec({
      components: base,
      connections: [
        { from: 'API', to: 'DB', callsPerRequest: 3, retries: 2, circuitBreaker: true },
        { from: 'API', to: 'Q', retries: 0, circuitBreaker: false },
      ],
    }));
    expect(doc.edges[0]).toMatchObject({ calls: 3, retries: 2, breaker: true });
    expect(doc.edges[1]).not.toHaveProperty('retries');
    expect(doc.edges[1]).not.toHaveProperty('breaker');
    expect(warnings).toEqual([]);
  });

  test('route from a non-gateway warns', () => {
    const { warnings } = buildDesign(spec({ components: base, connections: [{ from: 'API', to: 'DB', route: '/x' }] }));
    expect(warnings).toEqual(['route on API → DB only matters when the caller is a gateway.']);
  });

  test('call options from a load balancer or a queue warn', () => {
    const { warnings } = buildDesign(spec({
      components: base,
      connections: [{ from: 'LB', to: 'API', retries: 1 }, { from: 'Q', to: 'W', callsPerRequest: 2 }, { from: 'GW', to: 'W', circuitBreaker: true }],
    }));
    expect(warnings).toEqual([
      'callsPerRequest / retries / circuitBreaker on LB → API are ignored: a load balancer decides how traffic moves.',
      'callsPerRequest / retries / circuitBreaker on Q → W are ignored: a queue decides how traffic moves.',
    ]);
  });

  test('a duplicate connection is ignored with a warning (edge ids stay dense)', () => {
    const { doc, warnings } = buildDesign(spec({
      components: base,
      connections: [{ from: 'Users', to: 'GW' }, { from: 'users', to: 'gw', async: true }, { from: 'GW', to: 'API' }],
    }));
    expect(doc.edges.map((e) => e.id)).toEqual(['e_1', 'e_2']);
    expect(doc.edges[0].mode).toBe('sync');
    expect(warnings).toEqual(['Duplicate connection users → gw was ignored.']);
  });

  test('the reverse direction is not a duplicate', () => {
    const { doc } = buildDesign(spec({ components: base, connections: [{ from: 'API', to: 'W' }, { from: 'W', to: 'API' }] }));
    expect(doc.edges).toHaveLength(2);
  });
});

describe('buildDesign: warnings', () => {
  test('no users component', () => {
    const { warnings } = buildDesign({ name: 'x', components: [c('API', 'app')] });
    expect(warnings).toEqual(['No "users" component: nothing sends traffic, so the simulation shows zero load. Add { "name": "Users", "kind": "users" }.']);
  });

  test('replicas or horizontal autoscale without a balancer in front', () => {
    const { warnings } = buildDesign(spec({
      components: [c('Users', 'users'), c('A', 'app', { replicas: 3 }), c('B', 'app', { autoscale: { min: 2, max: 4 } }), c('C', 'app')],
      connections: [{ from: 'Users', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'C' }],
    }));
    expect(warnings).toEqual([
      '"A" has several servers but nothing balances traffic to it; put a load balancer, gateway or queue in front, or only one server gets work.',
      '"B" has several servers but nothing balances traffic to it; put a load balancer, gateway or queue in front, or only one server gets work.',
    ]);
  });

  test('no balancer warning behind an lb, gateway or queue, for vertical autoscale, or with no callers', () => {
    const { warnings } = buildDesign(spec({
      components: [
        c('Users', 'users'), c('LB', 'lb'), c('GW', 'gateway'), c('Q', 'queue'),
        c('A', 'app', { replicas: 3 }), c('B', 'app', { replicas: 3 }), c('W', 'worker', { autoscale: { max: 5 } }),
        c('V', 'app', { autoscale: { mode: 'vertical' } }), c('Lonely', 'app', { replicas: 4 }), c('R', 'cache', { replicas: 3 }),
      ],
      connections: [
        { from: 'Users', to: 'LB' }, { from: 'LB', to: 'A' }, { from: 'Users', to: 'GW' }, { from: 'GW', to: 'B' },
        { from: 'A', to: 'Q', async: true }, { from: 'Q', to: 'W', async: true }, { from: 'A', to: 'V' }, { from: 'A', to: 'R' },
      ],
    }));
    expect(warnings).toEqual([]);
  });
});

describe('buildDesign: groups, flows and notes', () => {
  test('groups get ids, labels, cycling colors and boxes', () => {
    const comps = [c('Users', 'users'), ...['A', 'B', 'C', 'D', 'E'].map((n) => c(n, 'app'))];
    const { doc } = buildDesign(spec({
      components: comps,
      groups: ['A', 'B', 'C', 'D', 'E'].map((m, i) => ({ name: `G${i}`, members: [m], ...(i === 1 && { color: 'orange' as const }) })),
    }));
    expect(doc.groups.map((g) => [g.id, g.label, g.color])).toEqual([
      ['g_1', 'G0', 'blue'], ['g_2', 'G1', 'orange'], ['g_3', 'G2', 'orange'], ['g_4', 'G3', 'gray'], ['g_5', 'G4', 'blue'],
    ]);
    for (const g of doc.groups) {
      expect(g.w).toBeGreaterThan(0);
      expect(g.h).toBeGreaterThan(0);
      expect(g).not.toHaveProperty('collapsed');
    }
  });

  test('explicit collapsed', () => {
    const { doc } = buildDesign(spec({ components: [c('Users', 'users'), c('A', 'app')], groups: [{ name: 'G', members: ['A'], collapsed: true }, { name: 'H', members: ['Users'], collapsed: false }] }));
    expect(doc.groups[0].collapsed).toBe(true);
    expect(doc.groups[1]).not.toHaveProperty('collapsed');
  });

  test('more than 30 components and 2+ groups collapse automatically unless told otherwise', () => {
    const comps = [c('Users', 'users'), ...Array.from({ length: 30 }, (_, i) => c(`S${i}`, 'app'))];
    const groups = [{ name: 'G1', members: ['S0', 'S1'] }, { name: 'G2', members: ['S2'] }, { name: 'G3', members: ['S3'], collapsed: false }];
    const big = buildDesign(spec({ components: comps, groups }));
    expect(big.doc.groups.map((g) => !!g.collapsed)).toEqual([true, true, false]);

    // 30 components: no auto-collapse
    expect(buildDesign(spec({ components: comps.slice(0, 30), groups })).doc.groups.every((g) => !g.collapsed)).toBe(true);
    // 31 components but one group: no auto-collapse
    expect(buildDesign(spec({ components: comps, groups: groups.slice(0, 1) })).doc.groups[0].collapsed).toBeUndefined();
  });

  test('flows map step names to node ids', () => {
    const { doc } = buildDesign(spec({
      components: [c('Users', 'users'), c('API', 'app'), c('DB', 'db')],
      flows: [{ name: 'Checkout', steps: ['users', 'API', 'DB'] }],
    }));
    expect(doc.flows).toEqual([{ id: 'f_1', name: 'Checkout', steps: ['n_users', 'n_api', 'n_db'] }]);
  });

  test('a note near a component sits right of it, level with its top; free notes go below the diagram', () => {
    const { doc } = buildDesign(spec({
      components: [c('Users', 'users'), c('API', 'app', { replicas: 4 })],
      connections: [{ from: 'Users', to: 'API' }],
      notes: [{ text: 'hot path', near: 'api' }, { text: 'free 1' }, { text: 'free 2' }],
    }));
    const api = nodeOf(doc, 'API');
    const [near, f1, f2] = doc.notes;
    expect(near.id).toBe('t_1');
    expect(near.text).toBe('hot path');
    expect(near.x).toBeGreaterThan(api.x + 56); // past the replicas fanned to the right
    expect(near.y).toBeLessThan(api.y);
    expect([f1.id, f2.id]).toEqual(['t_2', 't_3']);
    expect(f2.x - f1.x).toBe(220);
    expect(f1.y).toBe(f2.y);
    for (const n of doc.nodes) expect(f1.y).toBeGreaterThan(n.y + 100);
  });
});

describe('buildDesign: errors', () => {
  test('schema errors carry their path; a non-object is reported at (root)', () => {
    expect(issuesOf(null)).toEqual([{ path: '(root)', message: expect.any(String) }]);
    const issues = issuesOf({ name: 'x', components: [{ name: 'A', kind: 'robot' }], connections: [{ from: 'A' }] });
    expect(issues.map((i) => i.path)).toEqual(['components.0.kind', 'connections.0.to']);
  });

  test('SpecError message lists every problem, singular and plural', () => {
    try { buildDesign({ name: 'x', components: [] }); } catch (e) {
      expect(e).toBeInstanceOf(SpecError);
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/^Design spec has 1 problem:\n- components: /);
    }
    const err = new SpecError([{ path: 'a', message: 'one' }, { path: 'b', message: 'two' }]);
    expect(err.message).toBe('Design spec has 2 problems:\n- a: one\n- b: two');
    expect(err.issues).toHaveLength(2);
  });

  test('duplicate component names (case-insensitive)', () => {
    expect(issuesOf(spec({ components: [c('Users', 'users'), c('API', 'app'), c('api', 'worker')] }))).toEqual([
      { path: 'components.2.name', message: '"api" is used twice; component names must be unique.' },
    ]);
  });

  test('unknown names everywhere, with "did you mean" hints when close', () => {
    const issues = issuesOf(spec({
      components: [c('Users', 'users'), c('Feed Service', 'app'), c('Posts DB', 'db')],
      connections: [{ from: 'Users', to: 'Feed Servce' }, { from: 'Zebra', to: 'Posts DB' }, { from: 'Nope', to: 'Nada' }],
      groups: [{ name: 'G', members: ['Feed Service', 'Post DB'] }],
      flows: [{ name: 'F', steps: ['Usrs', 'Feed Service'] }],
      notes: [{ text: 'n', near: 'Redis' }, { text: 'ok', near: 'Users' }],
    }));
    expect(issues).toEqual([
      { path: 'connections.0.to', message: 'No component named "Feed Servce". Did you mean "Feed Service"?' },
      { path: 'connections.1.from', message: 'No component named "Zebra".' },
      { path: 'connections.2.from', message: 'No component named "Nope".' },
      { path: 'connections.2.to', message: 'No component named "Nada".' },
      { path: 'groups.0.members.1', message: 'No component named "Post DB". Did you mean "Posts DB"?' },
      { path: 'flows.0.steps.0', message: 'No component named "Usrs". Did you mean "Users"?' },
      { path: 'notes.0.near', message: 'No component named "Redis".' },
    ]);
  });

  test('suggestions allow distance 2 for short names and a third of the length for long ones', () => {
    const comps = [c('Users', 'users'), c('DB', 'db'), c('Notification Service', 'app')];
    const msg = (to: string) => issuesOf(spec({ components: comps, connections: [{ from: 'Users', to }] }))[0].message;
    expect(msg('XY')).toBe('No component named "XY". Did you mean "DB"?');
    expect(msg('Notifcation Srvce')).toContain('Did you mean "Notification Service"?');
    expect(msg('Payments Gateway Thing')).toBe('No component named "Payments Gateway Thing".');
  });

  test('self connection', () => {
    expect(issuesOf(spec({ components: [c('Users', 'users'), c('API', 'app')], connections: [{ from: 'API', to: 'api' }] }))).toEqual([
      { path: 'connections.0', message: '"API" cannot connect to itself.' },
    ]);
  });

  test('all problems are reported together, and a duplicate component is not referable by its duplicate', () => {
    const issues = issuesOf(spec({
      components: [c('Users', 'users'), c('A', 'app'), c('A', 'app')],
      connections: [{ from: 'A', to: 'A' }, { from: 'B', to: 'A' }],
    }));
    expect(issues.map((i) => i.path)).toEqual(['components.2.name', 'connections.0', 'connections.1.from']);
  });
});
