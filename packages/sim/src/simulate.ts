import type { DesignDoc, DesignEdge, DesignNode } from '@syslab/types';
import { KINDS, RPS_PER_USER, SIZES } from './catalog';
import { autoscale, dbConfig, lbConfig } from './factory';
import { balance, type Backend } from './balancer';

/** Mutable runtime state that lives on the client, never persisted. */
export interface Runtime {
  /** current replica count of horizontally autoscaled nodes */
  autoRep: Record<string, number>;
  /** ticks spent draining the last replica before scale-in */
  drain: Record<string, number>;
  /** current size index of vertically autoscaled nodes */
  autoSize: Record<string, number>;
  /** traffic multiplier (1 = off) */
  spike: number;
  /** messages waiting in each queue */
  qDepth: Record<string, number>;
}

export const EMPTY_RUNTIME: Runtime = { autoRep: {}, drain: {}, autoSize: {}, spike: 1, qDepth: {} };

/** A queue holds at most this many messages; beyond that new ones are rejected. */
export const QUEUE_MAX = 1_000_000;

/** Live state of one queue for the canvas and inspector. All rates are messages per second. */
export interface QueueStat {
  depth: number;
  inRate: number;
  outRate: number;
  /** how fast the consumers could pull if there were enough messages */
  drainCap: number;
  /** change in depth per second (negative = draining) */
  growth: number;
  full: boolean;
  consumers: number;
}

export interface DbLoad { w: number; r: number }

/** One backend as seen by a load balancer, for the inspector. */
export interface LbBackendStat {
  nodeId: string;
  edgeId: string;
  replica: number;
  /** fraction of the LB's traffic */
  share: number;
  rps: number;
  /** skipped by the health check */
  down: boolean;
}

export interface SimResult {
  users: number;
  rps: number;
  byId: Map<string, DesignNode>;
  inflow: Record<string, number>;
  cap: Record<string, number>;
  load: Record<string, number>;
  edgeRps: Record<string, number>;
  reps: Record<string, number>;
  sizeIdx: Record<string, number>;
  desiredReps: Record<string, number>;
  desiredSize: Record<string, number>;
  needsLB: Record<string, boolean>;
  dbLoad: Record<string, DbLoad>;
  /** load of each replica (uneven when a load balancer splits unevenly) */
  repLoad: Record<string, number[]>;
  /** rps on an edge towards each replica of its target (LB edges only) */
  edgeRepRps: Record<string, number[]>;
  /** per-LB backend breakdown */
  lbBackends: Record<string, LbBackendStat[]>;
  /** per-queue backlog */
  queue: Record<string, QueueStat>;
  nodeCost: Record<string, number>;
  nodeLatency: Record<string, number>;
  onSlowPath: Record<string, boolean>;
  errorRate: number;
  p95: number;
  cost: number;
}

export const isHorizontalAuto = (n: DesignNode) => !!KINDS[n.kind].canAuto && n.autoscale?.on && n.autoscale.mode !== 'v';
export const isVerticalAuto = (n: DesignNode) => !!KINDS[n.kind].canAuto && n.autoscale?.on && n.autoscale.mode === 'v';
export const isBalancer = (n?: DesignNode) => !!n && (n.kind === 'lb' || n.kind === 'gateway');

/**
 * Load above which a node really drops requests. Exactly 100% (e.g. a worker pulling from a
 * queue as fast as it can) is busy, not overloaded.
 */
export const OVERLOAD = 1.001;
export const isOver = (load: number) => load > OVERLOAD;

/** latency multiplier when a node runs hot */
export const congestion = (load: number) => (load < 0.7 ? 1 : 1 + Math.pow((Math.min(load, 1.6) - 0.7) / 0.3, 2) * 5);

function topoOrder(nodes: DesignNode[], out: Map<string, DesignEdge[]>, indeg: Record<string, number>): string[] {
  const order: string[] = [];
  const d = { ...indeg };
  const queue = nodes.filter((n) => d[n.id] === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of out.get(id) ?? []) if (--d[e.to] === 0) queue.push(e.to);
  }
  if (order.length < nodes.length) {
    const seen = new Set(order);
    for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);
  }
  return order;
}

/**
 * Pure, deterministic flow simulation of one design at steady state.
 * O(nodes + edges). Safe to run every render / tick.
 */
export function simulate(doc: DesignDoc, rt: Runtime = EMPTY_RUNTIME): SimResult {
  const { nodes, edges } = doc;
  const users = doc.users * (rt.spike || 1);
  const rps = users * RPS_PER_USER;
  const read = (doc.requirements?.read ?? 90) / 100;

  const byId = new Map<string, DesignNode>();
  const out = new Map<string, DesignEdge[]>();
  const indeg: Record<string, number> = {};
  for (const n of nodes) { byId.set(n.id, n); out.set(n.id, []); indeg[n.id] = 0; }

  const lbIn: Record<string, boolean> = {};
  const anyIn: Record<string, boolean> = {};
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    out.get(e.from)!.push(e);
    indeg[e.to]++;
    anyIn[e.to] = true;
    // workers behind a queue pull their own messages, so they scale out without a load balancer
    if (isBalancer(a) || a.kind === 'queue') lbIn[e.to] = true;
  }
  const order = topoOrder(nodes, out, indeg);

  const inflow: Record<string, number> = {}, cap: Record<string, number> = {}, load: Record<string, number> = {};
  const edgeRps: Record<string, number> = {}, reps: Record<string, number> = {}, per: Record<string, number> = {};
  const sizeIdx: Record<string, number> = {}, desiredReps: Record<string, number> = {}, desiredSize: Record<string, number> = {};
  const needsLB: Record<string, boolean> = {}, dbLoad: Record<string, DbLoad> = {};
  const repIn: Record<string, number[]> = {}, repLoad: Record<string, number[]> = {};
  const edgeRepRps: Record<string, number[]> = {}, lbBackends: Record<string, LbBackendStat[]> = {};
  const queue: Record<string, QueueStat> = {};
  /** rps a target node could take right now (0 when offline) */
  const capOf = (t: DesignNode) => (t.down ? 0 : t.kind === 'users' ? Infinity : per[t.id] * reps[t.id] * (t.kind === 'db' ? dbConfig(t).shards : 1));
  let dropped = 0, userNodes = 0;

  for (const n of nodes) {
    const k = KINDS[n.kind];
    const a = autoscale(n);
    inflow[n.id] = 0;
    sizeIdx[n.id] = isVerticalAuto(n) ? (rt.autoSize[n.id] ?? a.minSize) : n.size;
    per[n.id] = n.kind === 'users' ? Infinity : k.perCpu ? k.perCpu * SIZES[sizeIdx[n.id]].cpu : (k.cap ?? 0);
    needsLB[n.id] = !!(k.canAuto && (isHorizontalAuto(n) || n.replicas > 1) && anyIn[n.id] && !lbIn[n.id]);
    reps[n.id] = needsLB[n.id] ? 1 : isHorizontalAuto(n) ? (rt.autoRep[n.id] ?? a.min) : n.replicas;
    repIn[n.id] = new Array(Math.max(1, reps[n.id])).fill(0);
    if (n.kind === 'users') userNodes++;
  }

  for (const id of order) {
    const n = byId.get(id)!, k = KINDS[n.kind], a = autoscale(n);
    const inn = n.kind === 'users' ? rps : inflow[id];
    inflow[id] = inn;

    if (isHorizontalAuto(n) && !needsLB[id]) {
      desiredReps[id] = Math.max(a.min, Math.min(a.max, Math.ceil(inn / (per[id] * a.target / 100)) || a.min));
    }
    if (isVerticalAuto(n)) {
      let idx = a.minSize;
      while (idx < a.maxSize && (k.perCpu ?? 0) * SIZES[idx].cpu * reps[id] * a.target / 100 < inn) idx++;
      desiredSize[id] = idx;
    }

    let c = n.kind === 'users' ? Infinity : per[id] * reps[id];
    if (n.kind === 'db') {
      const D = dbConfig(n), base = per[id] * D.shards, R = D.replicas, wr = 1 - read, rd = read;
      if (R > 0) {
        c = Math.min(wr > 0 ? base / wr : Infinity, rd > 0 ? (base * R) / rd : Infinity);
        dbLoad[id] = { w: base > 0 ? (inn * wr) / base : 0, r: base > 0 ? (inn * rd) / (base * R) : 0 };
      } else {
        c = base;
        dbLoad[id] = { w: base > 0 ? inn / base : 0, r: base > 0 ? inn / base : 0 };
      }
    }
    if (n.down) c = 0;
    cap[id] = c;

    // A dead cache is bypassed (cache-aside): traffic falls through to its backing store.
    const bypass = n.kind === 'cache' && n.down;
    const ri = repIn[id];
    let served: number;
    if (!bypass && n.kind !== 'db' && n.kind !== 'users' && ri.length > 1 && Number.isFinite(c) && c > 0) {
      // Replicas are separate machines: one hot replica drops requests even if the others are idle.
      const perRep = c / ri.length;
      served = ri.reduce((s, x) => s + Math.min(x, perRep), 0);
      repLoad[id] = ri.map((x) => x / perRep);
      load[id] = Math.max(...repLoad[id]);
    } else {
      served = bypass ? inn : Math.min(inn, c);
      load[id] = c === Infinity ? 0 : c > 0 ? inn / c : inn > 0 ? 9 : 0;
      repLoad[id] = ri.map(() => load[id]);
    }
    dropped += inn - served;

    const pass = bypass ? 1 : n.kind === 'cache' ? read * 0.1 + (1 - read) : k.pass;
    const sent = served * pass;
    const all = out.get(id)!;

    if (n.kind === 'lb') {
      // Health check skips offline targets; the algorithm splits across every live replica.
      const L = lbConfig(n);
      const bs: Backend[] = [];
      const stats: LbBackendStat[] = [];
      for (const e of all) {
        const t = byId.get(e.to)!;
        edgeRps[e.id] = 0;
        edgeRepRps[e.id] = new Array(repIn[e.to].length).fill(0);
        for (let r = 0; r < repIn[e.to].length; r++) {
          if (t.down) { stats.push({ nodeId: t.id, edgeId: e.id, replica: r, share: 0, rps: 0, down: true }); continue; }
          const capRep = t.kind === 'users' ? Infinity : per[t.id];
          bs.push({ key: `${t.id}:${r}`, nodeId: t.id, edgeId: e.id, replica: r, cap: capRep, lat: KINDS[t.kind].lat || 1, weight: e.weight || 1 });
        }
      }
      const shares = balance(L.algo, bs, sent, L.vnodes, congestion);
      bs.forEach((b, i) => {
        const r = sent * shares[i];
        repIn[b.nodeId][b.replica] += r;
        inflow[b.nodeId] += r;
        edgeRps[b.edgeId] += r;
        edgeRepRps[b.edgeId][b.replica] = r;
        stats.push({ nodeId: b.nodeId, edgeId: b.edgeId, replica: b.replica, share: shares[i], rps: r, down: false });
      });
      lbBackends[id] = stats.sort((x, y) => (x.edgeId === y.edgeId ? x.replica - y.replica : all.findIndex((e) => e.id === x.edgeId) - all.findIndex((e) => e.id === y.edgeId)));
    } else if (n.kind === 'queue') {
      // A queue decouples producers from consumers: consumers pull only what they can handle,
      // the rest waits as backlog (drained on later ticks) instead of being dropped.
      const depth = rt.qDepth?.[id] ?? 0;
      const caps = all.map((e) => capOf(byId.get(e.to)!));
      const drainCap = caps.reduce((s, c) => s + c, 0);
      const out = n.down ? 0 : Math.min(drainCap, sent + depth);
      let growth = sent - out;
      const full = depth >= QUEUE_MAX;
      if (full && growth > 0) { dropped += growth; growth = 0; }
      queue[id] = { depth, inRate: sent, outRate: out, drainCap, growth, full, consumers: caps.filter((c) => c > 0).length };
      // competing consumers: each pulls in proportion to how fast it can work
      all.forEach((e, i) => {
        const share = drainCap === Infinity ? (caps[i] === Infinity ? 1 / caps.filter((c) => c === Infinity).length : 0) : drainCap > 0 ? caps[i] / drainCap : 0;
        const r = out * share;
        inflow[e.to] += r;
        edgeRps[e.id] = r;
        const tr = repIn[e.to];
        for (let j = 0; j < tr.length; j++) tr[j] += r / tr.length;
      });
    } else {
      const sumW = all.reduce((s, e) => s + (e.weight || 1), 0);
      for (const e of all) {
        const r = sumW ? (sent * (e.weight || 1)) / sumW : 0;
        inflow[e.to] += r;
        edgeRps[e.id] = r;
        // without a load balancer in between, traffic spreads evenly over the target's replicas
        const tr = repIn[e.to];
        for (let j = 0; j < tr.length; j++) tr[j] += r / tr.length;
      }
    }
  }

  const nodeCost: Record<string, number> = {};
  let cost = 0;
  for (const n of nodes) {
    const k = KINDS[n.kind];
    const D = n.kind === 'db' ? dbConfig(n) : null;
    const unit = k.perCpu ? SIZES[sizeIdx[n.id]].cost * (k.costMul ?? 1) : (k.fixed ?? 0);
    const c = unit * reps[n.id] * (D ? D.shards * (1 + D.replicas) : 1);
    nodeCost[n.id] = c;
    cost += c;
  }

  const total = rps * Math.max(1, userNodes);
  const errorRate = total > 0 ? Math.min(1, dropped / total) : 0;

  // Slowest synchronous path, computed bottom-up.
  const nodeLatency: Record<string, number> = {}, pathLat: Record<string, number> = {}, via: Record<string, string | null> = {};
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], n = byId.get(id)!, k = KINDS[n.kind];
    let down = 0, next: string | null = null;
    if (!k.async) {
      for (const e of out.get(id)!) {
        if (e.mode !== 'async' && pathLat[e.to] != null && pathLat[e.to] >= down) { down = pathLat[e.to]; next = e.id; }
      }
    }
    let base = k.lat;
    if (n.kind === 'db') {
      const D = dbConfig(n);
      if (D.partition !== 'none') base *= 0.7;
      if (D.sync && D.replicas > 0) base += 6;
      if (D.shards > 1 && D.strategy === 'range') base += 1;
    }
    nodeLatency[id] = n.kind === 'cache' && n.down ? 2 : base * congestion(load[id]);
    pathLat[id] = nodeLatency[id] + down;
    via[id] = next;
  }

  let start: string | null = null, worst = 0;
  for (const n of nodes) if (n.kind === 'users' && (pathLat[n.id] ?? 0) >= worst) { worst = pathLat[n.id] ?? 0; start = n.id; }
  const onSlowPath: Record<string, boolean> = {};
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (let cur = start, guard = 0; cur && via[cur] && guard < 64; guard++) {
    const eid = via[cur]!;
    onSlowPath[eid] = true;
    cur = edgeById.get(eid)?.to ?? null;
  }

  let p95 = (worst + 18) * 1.4;
  if (errorRate > 0.02) p95 = Math.max(p95, 1200 + errorRate * 6000);

  return {
    users, rps, byId, inflow, cap, load, edgeRps, reps, sizeIdx, desiredReps, desiredSize,
    needsLB, dbLoad, repLoad, edgeRepRps, lbBackends, queue, nodeCost, nodeLatency, onSlowPath, errorRate, p95, cost,
  };
}

/** Node with the highest load, ignoring users and offline nodes. */
export function bottleneck(doc: DesignDoc, sim: SimResult): { node: DesignNode; load: number } | null {
  let best: { node: DesignNode; load: number } | null = null;
  for (const n of doc.nodes) {
    if (n.kind === 'users' || n.down) continue;
    const l = sim.load[n.id] ?? 0;
    if (!best || l > best.load) best = { node: n, load: l };
  }
  return best;
}
