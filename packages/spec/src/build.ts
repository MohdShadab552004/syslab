import type { DesignDoc, DesignEdge, DesignGroup, DesignNode, DesignNote, NodeKind } from '@syslab/types';
import { DEFAULT_AUTOSCALE, DEFAULT_REQUIREMENTS, KINDS, blankDoc, isRingDb, makeEdge, makeNode } from '@syslab/sim';
import { DesignSpec, SIZE_VALUES, type ComponentSpec, type DesignSpecInput } from './schema';
import { layout } from './layout';

/** One problem in a spec, phrased so an LLM can fix it on the next try. */
export interface SpecIssue { path: string; message: string }

export class SpecError extends Error {
  constructor(public readonly issues: SpecIssue[]) {
    super(`Design spec has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n` + issues.map((i) => `- ${i.path}: ${i.message}`).join('\n'));
  }
}

export interface BuildResult {
  doc: DesignDoc;
  name: string;
  /** things that were accepted but adjusted (shown to the LLM so it learns) */
  warnings: string[];
}

const LB_ALGO = { round_robin: 'rr', weighted: 'wrr', least_connections: 'lc', ip_hash: 'hash' } as const;
const sizeIndex = (s?: string) => (s ? Math.max(0, SIZE_VALUES.indexOf(s as (typeof SIZE_VALUES)[number])) : undefined);
const key = (s: string) => s.trim().toLowerCase();
const slug = (s: string) => key(s).replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/^-+|-+$/g, '') || 'x';

/** Levenshtein distance, for "did you mean …" hints. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

function suggest(name: string, known: string[]): string {
  const best = known.map((k) => ({ k, d: distance(key(name), key(k)) })).sort((x, y) => x.d - y.d)[0];
  return best && best.d <= Math.max(2, Math.floor(best.k.length / 3)) ? ` Did you mean "${best.k}"?` : '';
}

/**
 * Validate a spec and turn it into an editor document with ids, settings and a laid-out diagram.
 * Throws SpecError with every problem at once (not just the first) so the caller can fix them together.
 */
export function buildDesign(input: DesignSpecInput | unknown): BuildResult {
  const parsed = DesignSpec.safeParse(input);
  if (!parsed.success) {
    throw new SpecError(parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })));
  }
  const spec = parsed.data;
  const issues: SpecIssue[] = [];
  const warnings: string[] = [];

  // ---- components: unique names, settings mapped onto the editor model ----
  const byName = new Map<string, ComponentSpec & { id: string }>();
  const usedIds = new Set<string>();
  spec.components.forEach((c, i) => {
    if (byName.has(key(c.name))) { issues.push({ path: `components.${i}.name`, message: `"${c.name}" is used twice; component names must be unique.` }); return; }
    let id = `n_${slug(c.name)}`;
    for (let n = 2; usedIds.has(id); n++) id = `n_${slug(c.name)}_${n}`;
    usedIds.add(id);
    byName.set(key(c.name), { ...c, id });
  });
  const names = spec.components.map((c) => c.name);
  const ref = (n: string, path: string) => {
    const c = byName.get(key(n));
    if (!c) issues.push({ path, message: `No component named "${n}".${suggest(n, names)}` });
    return c;
  };

  // ---- connections ----
  const edges: DesignEdge[] = [];
  const seen = new Set<string>();
  spec.connections.forEach((cn, i) => {
    const a = ref(cn.from, `connections.${i}.from`), b = ref(cn.to, `connections.${i}.to`);
    if (!a || !b) return;
    if (a.id === b.id) { issues.push({ path: `connections.${i}`, message: `"${cn.from}" cannot connect to itself.` }); return; }
    const k = `${a.id}>${b.id}`;
    if (seen.has(k)) { warnings.push(`Duplicate connection ${cn.from} → ${cn.to} was ignored.`); return; }
    seen.add(k);
    if (cn.route && a.kind !== 'gateway') warnings.push(`route on ${cn.from} → ${cn.to} only matters when the caller is a gateway.`);
    edges.push(makeEdge(`e_${edges.length + 1}`, a.id, b.id, {
      mode: cn.async ? 'async' : 'sync',
      proto: cn.protocol ?? (cn.async ? 'Pub/Sub' : 'REST'),
      op: cn.carries ?? 'both',
      weight: cn.weight ?? 1,
      route: cn.route ?? '',
      ...(cn.callsPerRequest && { calls: cn.callsPerRequest }),
      ...(cn.retries && { retries: cn.retries }),
      ...(cn.circuitBreaker && { breaker: true }),
    }));
    if ((cn.callsPerRequest || cn.retries || cn.circuitBreaker) && (a.kind === 'lb' || a.kind === 'queue')) warnings.push(`callsPerRequest / retries / circuitBreaker on ${cn.from} → ${cn.to} are ignored: a ${a.kind === 'lb' ? 'load balancer' : 'queue'} decides how traffic moves.`);
  });

  // ---- groups, flows, notes (references only for now) ----
  spec.groups.forEach((g, i) => g.members.forEach((m, j) => ref(m, `groups.${i}.members.${j}`)));
  spec.flows.forEach((f, i) => f.steps.forEach((s, j) => ref(s, `flows.${i}.steps.${j}`)));
  spec.notes.forEach((t, i) => { if (t.near) ref(t.near, `notes.${i}.near`); });

  if (issues.length) throw new SpecError(issues);

  // ---- nodes ----
  const nodes: DesignNode[] = [];
  for (const c of byName.values()) {
    const kind = c.kind as NodeKind;
    const k = KINDS[kind];
    const over: Partial<DesignNode> = {};
    if (c.tech) over.tech = c.tech;
    if (c.size) {
      if (k.perCpu) over.size = sizeIndex(c.size);
      else warnings.push(`size on "${c.name}" was ignored: ${k.name} has a fixed capacity.`);
    }
    if (c.replicas) over.replicas = c.replicas;
    if (c.autoscale) {
      if (!k.canAuto) warnings.push(`autoscale on "${c.name}" was ignored: only app and worker can autoscale.`);
      else if (c.autoscale.mode === 'vertical') {
        const lo = sizeIndex(c.autoscale.minSize) ?? DEFAULT_AUTOSCALE.minSize, hi = sizeIndex(c.autoscale.maxSize) ?? DEFAULT_AUTOSCALE.maxSize;
        over.autoscale = { ...DEFAULT_AUTOSCALE, on: true, mode: 'v', minSize: Math.min(lo, hi), maxSize: Math.max(lo, hi), target: c.autoscale.targetCpu ?? DEFAULT_AUTOSCALE.target };
      } else {
        let lo = c.autoscale.min ?? DEFAULT_AUTOSCALE.min, hi = c.autoscale.max ?? Math.max(lo, DEFAULT_AUTOSCALE.max);
        if (lo > hi) { warnings.push(`autoscale min > max on "${c.name}"; swapped them.`); [lo, hi] = [hi, lo]; }
        over.autoscale = { ...DEFAULT_AUTOSCALE, on: true, mode: 'h', min: lo, max: hi, target: c.autoscale.targetCpu ?? DEFAULT_AUTOSCALE.target };
      }
    }
    if (c.database) {
      if (kind !== 'db') warnings.push(`database settings on "${c.name}" were ignored: it is not a db.`);
      else if ((c.database.nodes != null || c.database.replicationFactor != null || c.database.consistency || c.database.failedNodes != null) && !isRingDb({ kind, tech: c.tech ?? '' })) {
        warnings.push(`nodes / replicationFactor / consistency on "${c.name}" only apply to ring databases (tech "Cassandra"); they were ignored.`);
      }
      if (kind === 'db') over.dbc = {
        ...(c.database.shards != null && { shards: c.database.shards }),
        ...(c.database.readReplicas != null && { replicas: c.database.readReplicas }),
        ...(c.database.syncReplication != null && { sync: c.database.syncReplication }),
        ...(c.database.shardKey && { shardKey: c.database.shardKey }),
        ...(c.database.shardStrategy && { strategy: c.database.shardStrategy }),
        ...(c.database.maxConnections != null && { maxConn: c.database.maxConnections }),
        ...(c.database.nodes != null && { nodes: c.database.nodes }),
        ...(c.database.replicationFactor != null && { rf: c.database.replicationFactor }),
        ...(c.database.consistency && { consistency: c.database.consistency }),
        ...(c.database.failedNodes != null && { downNodes: c.database.failedNodes }),
      };
    }
    if (c.loadBalancer) {
      if (kind !== 'lb') warnings.push(`loadBalancer settings on "${c.name}" were ignored: it is not an lb.`);
      else over.lbc = { ...(c.loadBalancer.algorithm && { algo: LB_ALGO[c.loadBalancer.algorithm] }), ...(c.loadBalancer.virtualNodes && { vnodes: c.loadBalancer.virtualNodes }) };
    }
    if (c.measured && (c.measured.requestsPerSecond || c.measured.latencyMs)) {
      if (kind === 'users') warnings.push(`measured numbers on "${c.name}" were ignored: users have no capacity.`);
      else over.measured = { ...(c.measured.requestsPerSecond && { rps: c.measured.requestsPerSecond }), ...(c.measured.latencyMs && { ms: c.measured.latencyMs }) };
    }
    if (c.queue) {
      if (kind !== 'queue') warnings.push(`queue settings on "${c.name}" were ignored: it is not a queue.`);
      else if (c.queue.mode) over.queuec = { mode: c.queue.mode };
    }
    if (c.cache) {
      if (kind !== 'cache') warnings.push(`cache settings on "${c.name}" were ignored: it is not a cache.`);
      else if (c.cache.ttlSeconds != null) over.cachec = { ttl: c.cache.ttlSeconds };
    }
    if (c.offline) over.down = true;
    nodes.push(makeNode(c.id, kind, 0, 0, c.name, over));
  }
  if (!nodes.some((n) => n.kind === 'users')) warnings.push('No "users" component: nothing sends traffic, so the simulation shows zero load. Add { "name": "Users", "kind": "users" }.');
  for (const n of nodes) {
    const isScaled = KINDS[n.kind].canAuto && (n.replicas > 1 || (n.autoscale.on && n.autoscale.mode === 'h'));
    const fed = edges.filter((e) => e.to === n.id);
    const balanced = fed.some((e) => ['lb', 'gateway', 'queue'].includes(nodes.find((x) => x.id === e.from)!.kind));
    if (isScaled && fed.length && !balanced) warnings.push(`"${n.label}" has several servers but nothing balances traffic to it; put a load balancer, gateway or queue in front, or only one server gets work.`);
  }

  // ---- layout: positions for nodes, boxes for groups, spots for notes ----
  const groupsIn = spec.groups.map((g) => ({ ...g, ids: g.members.map((m) => byName.get(key(m))!.id) }));
  const placed = layout(nodes, edges, groupsIn.map((g) => g.ids));
  for (const n of nodes) { const p = placed.nodes.get(n.id)!; n.x = p.x; n.y = p.y; }

  // big designs open as one card per group, so the first view is readable (expand to see inside)
  const autoCollapse = nodes.length > 30 && groupsIn.length >= 2;
  const groups: DesignGroup[] = groupsIn.map((g, i) => ({
    id: `g_${i + 1}`, label: g.name, color: g.color ?? (['blue', 'green', 'orange', 'gray'] as const)[i % 4],
    ...placed.groupBox(g.ids), ...((g.collapsed ?? autoCollapse) && { collapsed: true }),
  }));

  const notes: DesignNote[] = spec.notes.map((t, i) => {
    const anchor = t.near ? placed.nodes.get(byName.get(key(t.near))!.id) : undefined;
    // right of everything the component draws (replicas, shards, pills), level with its top
    const p = anchor ? { x: anchor.x + anchor.right + 20, y: anchor.y - anchor.top + 20 } : placed.freeSpot(i);
    return { id: `t_${i + 1}`, text: t.text, x: Math.round(p.x), y: Math.round(p.y) };
  });

  const flows = spec.flows.map((f, i) => ({ id: `f_${i + 1}`, name: f.name, steps: f.steps.map((s) => byName.get(key(s))!.id) }));

  const dau = spec.dailyActiveUsers ?? DEFAULT_REQUIREMENTS.dau;
  const doc = blankDoc({
    nodes, edges, groups, notes, flows,
    users: spec.users ?? (spec.dailyActiveUsers != null ? Math.round(dau * DEFAULT_REQUIREMENTS.peak / 100) : 12_000),
    requirements: {
      ...DEFAULT_REQUIREMENTS,
      goal: spec.goal ?? '',
      dau,
      read: spec.readPercent ?? DEFAULT_REQUIREMENTS.read,
      slo: spec.latencyTargetMs ?? DEFAULT_REQUIREMENTS.slo,
      ...(spec.avgResponseKb != null && { respKb: spec.avgResponseKb }),
      ...(spec.avgFileKb != null && { assetKb: spec.avgFileKb }),
      ...(spec.storageGb != null && { storageGb: spec.storageGb }),
    },
  });
  return { doc, name: spec.name, warnings };
}
