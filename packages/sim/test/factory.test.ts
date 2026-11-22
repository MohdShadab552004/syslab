import { describe, expect, test } from 'vitest';
import { S } from './helpers';

describe('factory', () => {
  test('uid keeps the prefix and is unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => S.uid('n_')));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id.startsWith('n_')).toBe(true);
  });

  test('makeNode fills defaults per kind and applies overrides', () => {
    const app = S.makeNode('a', 'app', 1, 2, 'API');
    expect(app).toEqual({
      id: 'a', kind: 'app', x: 1, y: 2, label: 'API', tech: 'Node.js', size: 2, replicas: 1, down: false,
      autoscale: S.DEFAULT_AUTOSCALE,
    });
    expect(app.autoscale).not.toBe(S.DEFAULT_AUTOSCALE); // a copy, safe to mutate
    expect(S.makeNode('w', 'worker', 0, 0, 'w').size).toBe(1);
    expect(S.makeNode('l', 'lb', 0, 0, 'l').size).toBe(2); // kinds without a default size
    expect(S.makeNode('q', 'queue', 0, 0, 'q').tech).toBe('Kafka');
    expect(S.makeNode('d', 'db', 0, 0, 'd', { size: 4, tech: 'MySQL' })).toMatchObject({ size: 4, tech: 'MySQL' });
  });

  test('makeEdge defaults to a sync REST call carrying reads and writes', () => {
    expect(S.makeEdge('e', 'a', 'b')).toEqual({ id: 'e', from: 'a', to: 'b', mode: 'sync', proto: 'REST', op: 'both', weight: 1, route: '' });
    expect(S.makeEdge('e', 'a', 'b', { mode: 'async', weight: 3 })).toMatchObject({ mode: 'async', weight: 3 });
  });

  test('autoscale presets', () => {
    expect(S.autoH(2, 8)).toEqual({ ...S.DEFAULT_AUTOSCALE, on: true, mode: 'h', min: 2, max: 8 });
    expect(S.autoV(1, 3)).toEqual({ ...S.DEFAULT_AUTOSCALE, on: true, mode: 'v', minSize: 1, maxSize: 3 });
  });

  test('blankDoc has every collection and accepts overrides', () => {
    const d = S.blankDoc();
    expect(d).toMatchObject({ schemaVersion: 1, nodes: [], edges: [], groups: [], notes: [], flows: [], users: 12000, lesson: null });
    expect(d.requirements).toEqual(S.DEFAULT_REQUIREMENTS);
    expect(d.requirements).not.toBe(S.DEFAULT_REQUIREMENTS);
    expect(S.blankDoc({ users: 5 }).users).toBe(5);
  });

  test('usersFromRequirements = DAU × peak share, never negative', () => {
    expect(S.usersFromRequirements(S.DEFAULT_REQUIREMENTS)).toBe(12000);
    expect(S.usersFromRequirements({ ...S.DEFAULT_REQUIREMENTS, dau: 333, peak: 10 })).toBe(33);
    expect(S.usersFromRequirements({ ...S.DEFAULT_REQUIREMENTS, dau: -100, peak: 10 })).toBe(0);
  });

  test('config readers merge node settings over defaults', () => {
    const plain = S.makeNode('n', 'db', 0, 0, 'n');
    expect(S.dbConfig(plain)).toEqual(S.DEFAULT_DB);
    expect(S.dbConfig({ ...plain, dbc: { shards: 3 } })).toEqual({ ...S.DEFAULT_DB, shards: 3 });
    expect(S.lbConfig(plain)).toEqual(S.DEFAULT_LB);
    expect(S.lbConfig({ ...plain, lbc: { algo: 'hash' } })).toEqual({ algo: 'hash', vnodes: 10 });
    expect(S.cacheConfig(plain)).toEqual(S.DEFAULT_CACHE);
    expect(S.cacheConfig({ ...plain, cachec: { ttl: 5 } })).toEqual({ ttl: 5 });
    expect(S.autoscale({ ...plain, autoscale: undefined })).toEqual(S.DEFAULT_AUTOSCALE);
    expect(S.autoscale({ ...plain, autoscale: { on: true } })).toEqual({ ...S.DEFAULT_AUTOSCALE, on: true });
  });
});

describe('techProfile', () => {
  test('known technologies have their own multipliers', () => {
    expect(S.techProfile({ kind: 'app', tech: 'Go' })).toMatchObject({ cap: 1.6, lat: 0.75 });
    expect(S.techProfile({ kind: 'db', tech: 'Postgres' }).conn).toBe(100);
    expect(S.techProfile({ kind: 'db', tech: 'MySQL' }).conn).toBe(151);
  });

  test('unknown technologies and kinds without profiles use the baseline', () => {
    const base = { cap: 1, lat: 1, note: '' };
    expect(S.techProfile({ kind: 'app', tech: 'Elixir' })).toEqual(base);
    expect(S.techProfile({ kind: 'users', tech: 'Web app' })).toEqual(base);
    expect(S.techProfile({ kind: 'store', tech: 'S3' })).toEqual(base);
  });

  test('every profiled technology is offered in the catalog', () => {
    for (const [kind, techs] of Object.entries(S.TECH_PROFILES)) {
      for (const t of Object.keys(techs)) expect(S.TECHS[kind]).toContain(t);
    }
  });
});

describe('catalog', () => {
  test('every kind has techs, an icon and a palette group', () => {
    const kinds = Object.keys(S.KINDS);
    const grouped = S.PALETTE_GROUPS.flatMap((g) => g.kinds);
    for (const k of kinds) {
      expect(S.TECHS[k].length).toBeGreaterThan(0);
      expect(S.ICONS[k]).toBeTruthy();
      expect(grouped).toContain(k);
    }
    expect(grouped).toHaveLength(kinds.length);
  });

  test('sized kinds have a per-vCPU rate; unsized kinds have a fixed capacity and cost', () => {
    for (const k of Object.values(S.KINDS) as any[]) {
      if (k.perCpu) expect(k.perCpu).toBeGreaterThan(0);
      else { expect(k.cap).toBeGreaterThan(0); expect(k.fixed).toBeGreaterThanOrEqual(0); }
    }
  });

  test('machine sizes grow in CPU, RAM and cost', () => {
    for (let i = 1; i < S.SIZES.length; i++) {
      expect(S.SIZES[i].cpu).toBeGreaterThan(S.SIZES[i - 1].cpu);
      expect(S.SIZES[i].ram).toBeGreaterThan(S.SIZES[i - 1].ram);
      expect(S.SIZES[i].cost).toBeGreaterThan(S.SIZES[i - 1].cost);
    }
    expect(S.SIZE_SCALE).toHaveLength(S.SIZES.length);
  });
});

describe('summarize', () => {
  test('a users-only doc previews as users', () => {
    const s = S.summarize(S.buildTemplate('blank').doc);
    expect(s).toEqual({ nodeCount: 1, flowCount: 0, previewKinds: ['users'], isLesson: false });
  });

  test('distinct non-user kinds in order, at most four', () => {
    const s = S.summarize(S.buildTemplate('ecom').doc);
    expect(s.nodeCount).toBe(10);
    expect(s.flowCount).toBe(2);
    expect(s.previewKinds).toEqual(['cdn', 'lb', 'app', 'cache']);
    expect(s.isLesson).toBe(false);
  });

  test('lessons are flagged', () => {
    const s = S.summarize(S.buildTemplate('lesson').doc);
    expect(s.isLesson).toBe(true);
    expect(s.previewKinds).toEqual(['app']);
  });
});
