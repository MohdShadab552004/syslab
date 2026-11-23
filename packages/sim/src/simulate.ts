import type { DesignDoc, DesignEdge, DesignNode } from '@syslab/types';
import { KINDS, RPS_PER_USER, SIZES } from './catalog';
import { autoscale, dbConfig, lbConfig, queueConfig } from './factory';
import { balance, type Backend } from './balancer';
import { SERVICE_P95, SERVICE_P99, queueTimes, workersFor } from './queueing';
import { techProfile } from './techs';
import { egressCost, priceNode, sizesOf, type NodePrice } from './pricing';
import { isRingDb, ringCapacity, ringConfig, ringLatencyFactor, ringNodeLoads, ringUnavailable, staleReadShare, type RingStat } from './ring';

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
  /** current hit ratio of caches that are not fully warm (cold after a restart, or expiring while the db is down) */
  cacheHit?: Record<string, number>;
  /** share of requests each node dropped on the previous tick (what retrying callers react to) */
  fail?: Record<string, number>;
  /** seconds each open circuit breaker (by edge id) stays open */
  breaker?: Record<string, number>;
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
  mode: 'pubsub' | 'work';
  /** pub/sub only: each subscriber's own backlog (lag) and pace */
  subscribers: SubscriberStat[];
}

/** One subscriber of a pub/sub queue: it gets every message and keeps its own backlog. */
export interface SubscriberStat { edgeId: string; nodeId: string; lag: number; outRate: number; growth: number; full: boolean }

/** Runtime key of a pub/sub subscriber's backlog (stored next to queue depths). */
export const lagKey = (queueId: string, edgeId: string) => `${queueId}>${edgeId}`;

export interface DbLoad { w: number; r: number }

/** Client connections a database needs vs. how many it accepts. */
export interface DbConns { need: number; limit: number }

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
  /** ring databases: their ring and the share of rows that cannot reach the consistency level */
  ring: Record<string, RingStat>;
  /** offline caches whose reads were sent on to the database instead of failing */
  cacheBypass: Record<string, boolean>;
  /** live caches backed by a database: false while every database behind it is offline (misses cannot refill) */
  cacheRefill: Record<string, boolean>;
  /** hit ratio each live cache is answering with right now */
  cacheHit: Record<string, number>;
  /** capacity of one instance (one shard for a db), requests/s */
  perInstance: Record<string, number>;
  /** time one request takes on an idle server, ms */
  service: Record<string, number>;
  /** concurrent workers per instance (threads / connections / cores) */
  workers: Record<string, number>;
  /** mean time a request waits in line at the node, ms */
  waitMs: Record<string, number>;
  /** share of arriving requests the node dropped this tick */
  dropFrac: Record<string, number>;
  /** databases with a connection limit: connections needed vs. allowed */
  dbConns: Record<string, DbConns>;
  /** edges whose retries multiplied the traffic (factor > 1) */
  retryAmp: Record<string, number>;
  /** edges whose circuit breaker is open (calls fail fast) */
  breakerOpen: Record<string, boolean>;
  /** monthly price of each component (AWS list prices, see pricing.ts) */
  nodeCost: Record<string, number>;
  /** how each component's price is made (service, instance type, category) */
  nodeCostDetail: Record<string, NodePrice>;
  /** internet data transfer for responses served from the origin */
  egress: { monthly: number; gb: number };
  /** mean latency a request spends in this node (service + waiting), ms */
  nodeLatency: Record<string, number>;
  onSlowPath: Record<string, boolean>;
  errorRate: number;
  /** share of requests rejected instantly by an open circuit breaker */
  fastFailRate: number;
  /** mean latency of the slowest synchronous path, ms */
  meanLatency: number;
  p95: number;
  p99: number;
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

/** share of cache reads answered from memory; the rest are misses that go on to the database */
export const CACHE_HIT = 0.9;

/** connections each app / worker instance keeps open to a database (HikariCP's default pool) */
export const POOL_PER_INSTANCE = 10;

/** round trip between the user and your edge over the internet, ms */
export const CLIENT_RTT_MS = 20;
/** one network hop inside the data center, ms */
export const HOP_MS = 0.5;

/** most retries a connection can be set to */
export const MAX_RETRIES = 3;

/**
 * Requests/s one instance of a node can serve at a given size: the kind's baseline × the
 * technology's multiplier, or the user's measured number (scaled with CPU for other sizes).
 */
export function capacityPerInstance(n: DesignNode, sizeIdx = n.size): number {
  if (n.kind === 'users') return Infinity;
  const k = KINDS[n.kind];
  const m = n.measured?.rps;
  if (m && m > 0) return k.perCpu ? (m * SIZES[sizeIdx].cpu) / SIZES[n.size].cpu : m;
  return (k.perCpu ? k.perCpu * SIZES[sizeIdx].cpu : (k.cap ?? 0)) * techProfile(n).cap;
}

/** Time one request takes on an idle instance, ms (measured, or the kind × technology estimate). */
export function serviceTime(n: DesignNode, read = 0.9): number {
  if (n.kind === 'users') return 0;
  const m = n.measured?.ms;
  if (m && m > 0) return m;
  let base = KINDS[n.kind].lat * techProfile(n).lat;
  if (n.kind === 'db' && isRingDb(n)) {
    // a coordinator node forwards to replicas and waits for k of them (reads and writes apart)
    return base * ringLatencyFactor(ringConfig(n), read) + 0.5;
  }
  if (n.kind === 'db') {
    const D = dbConfig(n);
    if (D.partition !== 'none') base *= 0.7;
    if (D.sync && D.replicas > 0) base += 6;
    if (D.shards > 1 && D.strategy === 'range') base += 1;
  }
  return base;
}

/** Max client connections one server of this database accepts, or null when there is no limit. */
export function dbConnLimit(n: DesignNode): number | null {
  const D = dbConfig(n);
  return D.maxConn > 0 ? D.maxConn : techProfile(n).conn ?? null;
}

/** how long a client waits before giving up on a request, ms */
export const TIMEOUT_MS = 1000;

/**
 * Mean latency of a server with `workers` workers and `serviceMs` per request at utilisation `rho`.
 * Past 100% the line only grows until requests hit the client timeout, so the extra wait climbs
 * with the overload and tops out at TIMEOUT_MS.
 */
export function latencyAt(workers: number, serviceMs: number, rho: number): number {
  const base = serviceMs + queueTimes(workers, serviceMs, rho).meanWait;
  return rho > 1 ? base + Math.min(TIMEOUT_MS, (rho - 1) * TIMEOUT_MS) : base;
}

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
  const inc = new Map<string, DesignEdge[]>();
  const indeg: Record<string, number> = {};
  for (const n of nodes) { byId.set(n.id, n); out.set(n.id, []); inc.set(n.id, []); indeg[n.id] = 0; }

  const lbIn: Record<string, boolean> = {};
  const anyIn: Record<string, boolean> = {};
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    out.get(e.from)!.push(e);
    inc.get(e.to)!.push(e);
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
  const cacheBypass: Record<string, boolean> = {};
  const cacheRefill: Record<string, boolean> = {}, cacheHit: Record<string, number> = {};
  const service: Record<string, number> = {}, workers: Record<string, number> = {}, waitMs: Record<string, number> = {};
  const dropFrac: Record<string, number> = {}, dbConns: Record<string, DbConns> = {};
  const retryAmp: Record<string, number> = {}, breakerOpen: Record<string, boolean> = {};
  /** traffic each edge was meant to carry before retries multiplied it (or a breaker cut it) */
  const edgeOrig: Record<string, number> = {};
  const hitOf = (id: string) => (cacheHit[id] = rt.cacheHit?.[id] ?? CACHE_HIT);
  /** a dead read-through cache passes traffic on; any other dead node fails it */
  const passesWhenDown = (t: DesignNode) => t.kind === 'cache' && out.get(t.id)!.length > 0;
  /** rps a target node could take right now (0 when offline) */
  const capOf = (t: DesignNode) => (t.down ? 0 : t.kind === 'users' ? Infinity
    : isRingDb(t) ? ringCapacity(ringConfig(t), per[t.id], read)
    : per[t.id] * reps[t.id] * (t.kind === 'db' ? dbConfig(t).shards : 1));
  const ring: SimResult['ring'] = {};
  /** share of arrivals a node rejects instantly (a ring without enough live replicas: UnavailableException) */
  const ownFast: Record<string, number> = {};

  for (const n of nodes) {
    const k = KINDS[n.kind];
    const a = autoscale(n);
    inflow[n.id] = 0;
    sizeIdx[n.id] = isVerticalAuto(n) ? (rt.autoSize[n.id] ?? a.minSize) : n.size;
    per[n.id] = n.kind === 'users' ? Infinity : capacityPerInstance(n, sizeIdx[n.id]);
    service[n.id] = serviceTime(n, read);
    workers[n.id] = workersFor(per[n.id], service[n.id]);
    needsLB[n.id] = !!(k.canAuto && (isHorizontalAuto(n) || n.replicas > 1) && anyIn[n.id] && !lbIn[n.id]);
    reps[n.id] = needsLB[n.id] ? 1 : isHorizontalAuto(n) ? (rt.autoRep[n.id] ?? a.min) : n.replicas;
    repIn[n.id] = new Array(Math.max(1, reps[n.id])).fill(0);
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
      while (idx < a.maxSize && capacityPerInstance(n, idx) * reps[id] * a.target / 100 < inn) idx++;
      desiredSize[id] = idx;
    }

    let c = n.kind === 'users' ? Infinity : per[id] * reps[id];
    /** share of requests that get a database connection at all */
    let connOk = 1;
    /** a ring serves per node: a hot partition overloads its replicas while the rest idle */
    let ringServed: number | null = null;
    if (n.kind === 'db' && isRingDb(n)) {
      // Ring: writes go to every replica, reads ask k of them, failed nodes serve nothing, and rows
      // whose live replicas are fewer than the consistency level fail at once (UnavailableException).
      const r = ringConfig(n);
      const L = ringNodeLoads(r, per[id], read, inn);
      const unavailable = ringUnavailable(r, read);
      ring[id] = { ...r, ...L, unavailable, stale: staleReadShare(r.rf, r.k, r.kw) };
      c = L.cap;
      dbLoad[id] = { w: L.hotLoad, r: L.hotLoad };
      connOk = 1 - unavailable;
      ringServed = inn * connOk * (1 - L.drop);
      ownFast[id] = inn > 0 ? unavailable : 0;
    } else if (n.kind === 'db') {
      const D = dbConfig(n), base = per[id] * D.shards, R = D.replicas, wr = 1 - read, rd = read;
      if (R > 0) {
        c = Math.min(wr > 0 ? base / wr : Infinity, rd > 0 ? (base * R) / rd : Infinity);
        dbLoad[id] = { w: base > 0 ? (inn * wr) / base : 0, r: base > 0 ? (inn * rd) / (base * R) : 0 };
      } else {
        c = base;
        dbLoad[id] = { w: base > 0 ? inn / base : 0, r: base > 0 ? inn / base : 0 };
      }
      // Every app / worker instance holds its own pool of connections. Past the server's
      // max_connections, new connections are refused ("too many clients") and those requests fail.
      const limitPer = dbConnLimit(n);
      if (limitPer) {
        const need = inc.get(id)!.reduce((s, e) => {
          const f = byId.get(e.from)!;
          return s + (e.mode !== 'async' && (f.kind === 'app' || f.kind === 'worker') && !f.down ? reps[f.id] * POOL_PER_INSTANCE : 0);
        }, 0);
        const limit = limitPer * D.shards * (1 + R);
        if (need > 0) dbConns[id] = { need, limit };
        if (need > limit) connOk = limit / need;
      }
    }
    if (n.down) c = 0;
    cap[id] = c;

    // A dead read-through cache (cache → db) is bypassed: traffic falls through to its backing store.
    // A dead cache with nothing behind it just fails; a caller that also talks to the db sends the
    // reads there instead (cache-aside, handled where the caller splits its traffic below).
    const bypass = n.down && passesWhenDown(n);
    if (bypass) cacheBypass[id] = true;
    const ri = repIn[id];
    let served: number;
    if (!bypass && n.kind !== 'db' && n.kind !== 'users' && ri.length > 1 && Number.isFinite(c) && c > 0) {
      // Replicas are separate machines: one hot replica drops requests even if the others are idle.
      const perRep = c / ri.length;
      served = ri.reduce((s, x) => s + Math.min(x, perRep), 0);
      repLoad[id] = ri.map((x) => x / perRep);
      load[id] = Math.max(...repLoad[id]);
    } else {
      served = bypass ? inn : ringServed != null && !n.down ? ringServed : Math.min(inn * connOk, c);
      load[id] = c === Infinity ? 0 : c > 0 ? inn / c : inn > 0 ? 9 : 0;
      repLoad[id] = ri.map(() => load[id]);
    }
    dropFrac[id] = inn > 0 ? (inn - served) / inn : n.down && !bypass ? 1 : 0;

    const all = out.get(id)!;
    // read-through: misses (and writes) go on to whatever sits behind the cache
    if (n.kind === 'cache' && !n.down && all.length) cacheRefill[id] = all.some((e) => !byId.get(e.to)!.down);
    const pass = bypass ? 1 : n.kind === 'cache' ? (n.down ? 0 : read * (1 - hitOf(id)) + (1 - read)) : k.pass;
    const sent = served * pass;

    if (n.kind === 'lb') {
      // Health check skips offline targets; the algorithm splits across every live replica.
      const L = lbConfig(n);
      const bs: Backend[] = [];
      const stats: LbBackendStat[] = [];
      for (const e of all) {
        const t = byId.get(e.to)!;
        edgeRps[e.id] = 0;
        edgeOrig[e.id] = 0;
        edgeRepRps[e.id] = new Array(repIn[e.to].length).fill(0);
        for (let r = 0; r < repIn[e.to].length; r++) {
          if (t.down) { stats.push({ nodeId: t.id, edgeId: e.id, replica: r, share: 0, rps: 0, down: true }); continue; }
          const capRep = t.kind === 'users' ? Infinity : per[t.id];
          bs.push({ key: `${t.id}:${r}`, nodeId: t.id, edgeId: e.id, replica: r, cap: capRep, lat: service[t.id] || 1, workers: workers[t.id], weight: e.weight || 1 });
        }
      }
      // every backend offline: the balancer has nowhere to send requests and answers 503
      if (!bs.length && all.length && sent > 0) dropFrac[id] = 1;
      const shares = balance(L.algo, bs, sent, L.vnodes, (b, r) => (Number.isFinite(b.cap) && b.cap > 0 ? latencyAt(b.workers, b.lat, r / b.cap) : b.lat));
      bs.forEach((b, i) => {
        const r = sent * shares[i];
        repIn[b.nodeId][b.replica] += r;
        inflow[b.nodeId] += r;
        edgeRps[b.edgeId] += r;
        edgeOrig[b.edgeId] += r;
        edgeRepRps[b.edgeId][b.replica] = r;
        stats.push({ nodeId: b.nodeId, edgeId: b.edgeId, replica: b.replica, share: shares[i], rps: r, down: false });
      });
      lbBackends[id] = stats.sort((x, y) => (x.edgeId === y.edgeId ? x.replica - y.replica : all.findIndex((e) => e.id === x.edgeId) - all.findIndex((e) => e.id === y.edgeId)));
    } else if (n.kind === 'queue' && queueConfig(n).mode === 'pubsub' && all.length) {
      // Pub/sub (Kafka topic, SNS): every subscriber gets every message and reads at its own pace.
      // Each keeps its own backlog (consumer lag); a slow subscriber never slows the others and
      // never fails the producer. At the cap, the oldest messages expire for that subscriber.
      const subs: SubscriberStat[] = all.map((e) => {
        const t = byId.get(e.to)!, cap = capOf(t), lag = rt.qDepth?.[lagKey(id, e.id)] ?? 0;
        const outRate = n.down ? 0 : Math.min(cap, sent + lag);
        let growth = sent - outRate;
        const full = lag >= QUEUE_MAX && growth > 0;
        if (full) growth = 0;
        return { edgeId: e.id, nodeId: t.id, lag, outRate, growth, full };
      });
      subs.forEach((s, i) => {
        const e = all[i];
        inflow[e.to] += s.outRate;
        edgeRps[e.id] = s.outRate;
        edgeOrig[e.id] = s.outRate;
        const tr = repIn[e.to];
        for (let j = 0; j < tr.length; j++) tr[j] += s.outRate / tr.length;
      });
      // the queue as a whole is as far behind as its slowest subscriber
      const slow = subs.reduce((a, b) => (b.lag + b.growth > a.lag + a.growth ? b : a));
      queue[id] = {
        depth: slow.lag, inRate: sent, outRate: slow.outRate, drainCap: Math.min(...subs.map((s) => capOf(byId.get(s.nodeId)!))),
        growth: slow.growth, full: subs.some((s) => s.full), consumers: subs.filter((s) => capOf(byId.get(s.nodeId)!) > 0).length,
        mode: 'pubsub', subscribers: subs,
      };
    } else if (n.kind === 'queue') {
      // A work queue decouples producers from consumers: each message goes to one consumer, who
      // pull only what they can handle; the rest waits as backlog instead of being dropped.
      const depth = rt.qDepth?.[id] ?? 0;
      const caps = all.map((e) => capOf(byId.get(e.to)!));
      const drainCap = caps.reduce((s, c) => s + c, 0);
      const outRate = n.down ? 0 : Math.min(drainCap, sent + depth);
      let growth = sent - outRate;
      const full = depth >= QUEUE_MAX;
      // a full queue rejects what it cannot hold
      if (full && growth > 0) { dropFrac[id] = sent > 0 ? Math.min(1, growth / sent) : 0; growth = 0; }
      queue[id] = { depth, inRate: sent, outRate, drainCap, growth, full, consumers: caps.filter((c) => c > 0).length, mode: 'work', subscribers: [] };
      // competing consumers: each pulls in proportion to how fast it can work
      all.forEach((e, i) => {
        const share = drainCap === Infinity ? (caps[i] === Infinity ? 1 / caps.filter((c) => c === Infinity).length : 0) : drainCap > 0 ? caps[i] / drainCap : 0;
        const r = outRate * share;
        inflow[e.to] += r;
        edgeRps[e.id] = r;
        edgeOrig[e.id] = r;
        const tr = repIn[e.to];
        for (let j = 0; j < tr.length; j++) tr[j] += r / tr.length;
      });
    } else {
      const w = (e: DesignEdge) => e.weight || 1;
      const sumOf = (es: DesignEdge[]) => es.reduce((s, e) => s + w(e), 0);
      const send = (e: DesignEdge, r: number) => {
        if (r <= 0) return;
        const t = byId.get(e.to)!;
        edgeOrig[e.id] += r;
        // An open circuit breaker rejects calls instantly: the request fails fast, the target rests.
        if (e.breaker && (rt.breaker?.[e.id] ?? 0) > 0) { breakerOpen[e.id] = true; return; }
        // Retries: a call that fails is sent again, up to `retries` times. If the target dropped a
        // share f last second, each request now costs 1 + f + f² + … attempts (a retry storm).
        const retries = Math.max(0, Math.min(MAX_RETRIES, Math.round(e.retries ?? 0)));
        const fPrev = t.down ? (passesWhenDown(t) ? 0 : 1) : rt.fail?.[t.id] ?? 0;
        const amp = retries > 0 && fPrev > 0 ? (fPrev >= 1 ? retries + 1 : (1 - Math.pow(fPrev, retries + 1)) / (1 - fPrev)) : 1;
        if (amp > 1.001) retryAmp[e.id] = amp;
        const x = r * amp;
        inflow[e.to] += x;
        edgeRps[e.id] += x;
        // without a load balancer in between, traffic spreads evenly over the target's replicas
        const tr = repIn[e.to];
        for (let j = 0; j < tr.length; j++) tr[j] += x / tr.length;
      };
      const split = (es: DesignEdge[], r: number) => { const sw = sumOf(es); for (const e of es) send(e, sw ? (r * w(e)) / sw : 0); };
      for (const e of all) { edgeRps[e.id] = 0; edgeOrig[e.id] = 0; }

      // Fan-out: a connection with "calls per request" gets that many calls for every request,
      // on top of whatever the other connections get. The rest split the traffic by weight.
      const fan = all.filter((e) => (e.calls ?? 0) > 0);
      for (const e of fan) send(e, sent * (e.calls ?? 0));
      const rest = fan.length ? all.filter((e) => !((e.calls ?? 0) > 0)) : all;

      // Cache-aside: the caller talks to a cache *and* to the database itself. Every read asks the
      // cache first and only misses go on to the database; writes go straight to the database.
      // When the cache is offline, all of its reads land on the database.
      const caches = rest.filter((e) => byId.get(e.to)!.kind === 'cache' && out.get(e.to)!.length === 0);
      const stores = rest.filter((e) => { const t = byId.get(e.to)!.kind; return t === 'db' || t === 'store'; });
      if (caches.length && stores.length) {
        const lane = new Set([...caches, ...stores]);
        const sumW = sumOf(rest);
        split(rest.filter((e) => !lane.has(e)), (sent * sumOf(rest.filter((e) => !lane.has(e)))) / sumW);
        const laneRps = (sent * sumOf([...lane])) / sumW;
        const reads = laneRps * read, cw = sumOf(caches);
        // a db connection marked read-only / write-only only gets that kind of traffic
        const carrying = (op: 'read' | 'write') => { const m = stores.filter((e) => e.op === op || e.op === 'both'); return m.length ? m : stores; };
        const dbUp = carrying('read').some((e) => !byId.get(e.to)!.down);
        let toDb = 0;
        for (const e of caches) {
          const r = (reads * w(e)) / cw;
          if (byId.get(e.to)!.down) { toDb += r; cacheBypass[e.to] = true; }
          else { send(e, r); toDb += r * (1 - hitOf(e.to)); cacheRefill[e.to] = dbUp; }
        }
        split(carrying('read'), toDb);
        split(carrying('write'), laneRps - reads);
      } else {
        split(rest, sent);
      }
    }
  }

  // Monthly bill at AWS list prices: instances for sized components, usage for the rest
  // (requests, GB out, brokers), plus internet data transfer for what the origin serves.
  const nodeCost: Record<string, number> = {}, nodeCostDetail: Record<string, NodePrice> = {};
  const sz = sizesOf(doc);
  let cost = 0;
  for (const n of nodes) {
    const p = priceNode(n, { rps: n.kind === 'users' ? 0 : inflow[n.id] ?? 0, sizeIdx: sizeIdx[n.id], reps: reps[n.id], read, ...sz });
    nodeCostDetail[n.id] = p;
    nodeCost[n.id] = p.monthly;
    cost += p.monthly;
  }
  const originRps = edges.reduce((s, e) => s + (byId.get(e.from)?.kind === 'users' && byId.get(e.to)?.kind !== 'cdn' ? edgeRps[e.id] ?? 0 : 0), 0);
  const egress = egressCost(originRps, sz.respKb);
  cost += egress.monthly;

  // User-facing errors, bottom-up: the share of requests arriving at a node that end up failing.
  // A request fails if this node drops it, or if a call it needs fails. Fan-out calls must all
  // succeed; split traffic fails in proportion to the path it took; a call retried r times fails
  // only if every attempt fails; an open breaker fails its calls instantly (counted apart, since
  // those do not wait for a timeout). Queues buffer, so work behind them never fails the request.
  const fail: Record<string, number> = {}, fast: Record<string, number> = {};
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], n = byId.get(id)!, f = dropFrac[id] ?? 0;
    const served = n.kind === 'users' ? rps : inflow[id] * (1 - f);
    let okAll = 1, fastOk = 1, splitFail = 0, splitFast = 0;
    if (n.kind !== 'queue' && served > 0) {
      for (const e of out.get(id)!) {
        const o = edgeOrig[e.id] ?? 0;
        if (o <= 0) continue;
        const share = o / served;
        const retries = Math.max(0, Math.min(MAX_RETRIES, Math.round(e.retries ?? 0)));
        const eFail = breakerOpen[e.id] ? 1 : Math.pow(fail[e.to] ?? 0, retries + 1);
        const eFast = breakerOpen[e.id] ? 1 : fast[e.to] ?? 0;
        if ((e.calls ?? 0) > 0) { okAll *= Math.pow(1 - eFail, share); fastOk *= Math.pow(1 - eFast, share); }
        else { splitFail += share * eFail; splitFast += share * eFast; }
      }
    }
    const down = 1 - okAll * (1 - Math.min(1, splitFail));
    fail[id] = 1 - (1 - f) * (1 - down);
    fast[id] = Math.min(fail[id], (ownFast[id] ?? 0) + (1 - f) * (1 - fastOk * (1 - Math.min(1, splitFast))));
  }
  const sources = nodes.filter((n) => n.kind === 'users');
  const errorRate = rps > 0 && sources.length ? Math.min(1, sources.reduce((s, n) => s + fail[n.id], 0) / sources.length) : 0;
  const fastFailRate = rps > 0 && sources.length ? Math.min(errorRate, sources.reduce((s, n) => s + fast[n.id], 0) / sources.length) : 0;
  /** requests that failed by waiting for a timeout (not fast-failed by a breaker) */
  const timeoutRate = Math.max(0, errorRate - fastFailRate);

  // Latency, bottom-up along synchronous calls. Each node adds its service time plus the time
  // spent waiting in line (Erlang C). Means add up along the path; the spread of each hop adds as
  // independent variances, which gives the path's P95 / P99 without simulating single requests.
  const nodeLatency: Record<string, number> = {}, via: Record<string, string | null> = {};
  const pMean: Record<string, number> = {}, pVar95: Record<string, number> = {}, pVar99: Record<string, number> = {};
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], n = byId.get(id)!, k = KINDS[n.kind];
    let dMean = 0, dVar95 = 0, dVar99 = 0, next: string | null = null;
    if (!k.async) {
      for (const e of out.get(id)!) {
        if (e.mode === 'async' || pMean[e.to] == null || breakerOpen[e.id]) continue;
        // sequential calls: three calls cost three times the time
        const calls = Math.max(1, e.calls ?? 1);
        const m = (pMean[e.to] + HOP_MS) * calls;
        if (m >= dMean) { dMean = m; dVar95 = pVar95[e.to] * calls; dVar99 = pVar99[e.to] * calls; next = e.id; }
      }
    }
    let mean: number, s95: number, s99: number;
    if (n.kind === 'users') {
      mean = CLIENT_RTT_MS; s95 = CLIENT_RTT_MS * 0.5; s99 = CLIENT_RTT_MS;
    } else if (n.kind === 'cache' && n.down) {
      // a dead cache costs a fast connection error before the fallback
      mean = 2; s95 = 0; s99 = 0;
    } else {
      const S = service[id], q = queueTimes(workers[id], S, load[id] ?? 0);
      waitMs[id] = q.meanWait;
      mean = latencyAt(workers[id], S, load[id] ?? 0);
      s95 = Math.max(0, S * SERVICE_P95 + q.p95Wait - mean);
      // speculative retry asks another replica once the first is slower than its p99: the tail shrinks
      const tail = ring[id]?.specRetry ? SERVICE_P95 * 1.1 : SERVICE_P99;
      s99 = Math.max(0, S * tail + q.p99Wait - mean);
    }
    nodeLatency[id] = n.kind === 'users' ? 0 : mean;
    pMean[id] = mean + dMean;
    pVar95[id] = s95 * s95 + dVar95;
    pVar99[id] = s99 * s99 + dVar99;
    via[id] = next;
  }

  let start: string | null = null, worst = 0;
  for (const n of nodes) if (n.kind === 'users' && pMean[n.id] != null && (out.get(n.id)!.length > 0) && pMean[n.id] >= worst) { worst = pMean[n.id]; start = n.id; }
  const onSlowPath: Record<string, boolean> = {};
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (let cur = start, guard = 0; cur && via[cur] && guard < 64; guard++) {
    const eid = via[cur]!;
    onSlowPath[eid] = true;
    cur = edgeById.get(eid)?.to ?? null;
  }

  const meanLatency = start ? worst : 0;
  let p95 = start ? worst + Math.sqrt(pVar95[start]) : 0;
  let p99 = start ? worst + Math.sqrt(pVar99[start]) : 0;
  // Requests that are dropped hang until the client times out; once they are a few percent of
  // traffic, they are the tail.
  if (timeoutRate > 0.02) p95 = Math.max(p95, 1200 + timeoutRate * 6000);
  if (timeoutRate > 0.005) p99 = Math.max(p99, 1200 + Math.min(1, timeoutRate * 4) * 6000);
  p99 = Math.max(p99, p95);

  return {
    users, rps, byId, inflow, cap, load, edgeRps, reps, sizeIdx, desiredReps, desiredSize,
    needsLB, dbLoad, repLoad, edgeRepRps, lbBackends, queue, cacheBypass, cacheRefill, cacheHit,
    perInstance: per, service, workers, waitMs, dropFrac, dbConns, retryAmp, breakerOpen, ring,
    nodeCost, nodeCostDetail, egress, nodeLatency, onSlowPath, errorRate, fastFailRate, meanLatency, p95, p99, cost,
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
