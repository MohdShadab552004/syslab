import type { DesignDoc, DesignGroup } from '@syslab/types';
import { DEFAULT_AUTOSCALE, KINDS, SIZES, dbConfig, lbConfig } from '@syslab/sim';
import { SIZE_VALUES, type DesignSpecInput } from './schema';

const LB_NAME = { rr: 'round_robin', wrr: 'weighted', lc: 'least_connections', hash: 'ip_hash' } as const;
const sizeName = (i: number) => SIZE_VALUES[Math.max(0, Math.min(SIZES.length - 1, i))];

/** Same rule as the editor: nodes / notes whose anchor sits inside the box. */
function membersOf(doc: DesignDoc, g: DesignGroup): string[] {
  const inside = (x: number, y: number) => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
  return doc.nodes.filter((n) => inside(n.x, n.y)).map((n) => n.id);
}

/**
 * Turn an editor document back into the name-based spec, so an LLM can read a design,
 * change it and send it back with update_design. Positions are dropped (layout is automatic);
 * duplicate labels get a " (2)" suffix so names stay unique.
 */
export function docToSpec(name: string, doc: DesignDoc): DesignSpecInput {
  const label = new Map<string, string>();
  const used = new Set<string>();
  for (const n of doc.nodes) {
    let l = n.label.trim() || KINDS[n.kind].name;
    for (let i = 2; used.has(l.toLowerCase()); i++) l = `${n.label} (${i})`;
    used.add(l.toLowerCase());
    label.set(n.id, l);
  }
  const r = doc.requirements;
  return {
    name,
    goal: r.goal || undefined,
    users: doc.users,
    dailyActiveUsers: r.dau,
    readPercent: r.read,
    latencyTargetMs: r.slo,
    components: doc.nodes.map((n) => {
      const k = KINDS[n.kind];
      const as = { ...DEFAULT_AUTOSCALE, ...n.autoscale };
      const D = n.kind === 'db' ? dbConfig(n) : null;
      const L = n.kind === 'lb' ? lbConfig(n) : null;
      return {
        name: label.get(n.id)!,
        kind: n.kind,
        tech: n.tech || undefined,
        ...(k.perCpu && { size: sizeName(n.size) }),
        ...(n.replicas > 1 && { replicas: n.replicas }),
        ...(k.canAuto && as.on && (as.mode === 'v'
          ? { autoscale: { mode: 'vertical' as const, minSize: sizeName(as.minSize), maxSize: sizeName(as.maxSize), targetCpu: as.target } }
          : { autoscale: { mode: 'horizontal' as const, min: as.min, max: as.max, targetCpu: as.target } })),
        ...(D && { database: { shards: D.shards, readReplicas: D.replicas, syncReplication: D.sync, shardKey: D.shardKey, shardStrategy: D.strategy } }),
        ...(L && { loadBalancer: { algorithm: LB_NAME[L.algo], ...(L.algo === 'hash' && { virtualNodes: L.vnodes as 1 | 10 | 100 }) } }),
        ...(n.down && { offline: true }),
      };
    }),
    connections: doc.edges.filter((e) => label.has(e.from) && label.has(e.to)).map((e) => ({
      from: label.get(e.from)!,
      to: label.get(e.to)!,
      ...(e.mode === 'async' && { async: true }),
      protocol: e.proto,
      ...(e.op !== 'both' && { carries: e.op }),
      ...((e.weight || 1) !== 1 && { weight: e.weight }),
      ...(e.route && { route: e.route }),
    })),
    groups: doc.groups.map((g) => ({ name: g.label, color: g.color, members: membersOf(doc, g).map((id) => label.get(id)!), ...(g.collapsed && { collapsed: true }) }))
      .filter((g) => g.members.length > 0),
    flows: doc.flows.filter((f) => f.steps.length >= 2 && f.steps.every((s) => label.has(s))).map((f) => ({ name: f.name, steps: f.steps.map((s) => label.get(s)!) })),
    notes: doc.notes.map((t) => ({ text: t.text })),
  };
}
