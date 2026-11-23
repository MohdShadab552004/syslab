import type { DesignNode, RingConsistency } from '@syslab/types';
import { dbConfig } from './factory';
import { techProfile } from './techs';
import type { Point } from './layout';

/**
 * Leaderless "ring" databases (Cassandra and friends): every node is equal, data is spread over a
 * consistent-hash ring, each row lives on `rf` nodes, and a read or write waits for `k` of them
 * (the consistency level). Adding nodes adds capacity; replicas let the cluster survive failures.
 */

export const RING_MIN_NODES = 3;
export const RING_MAX_NODES = 24;
/** most nodes drawn around the ring */
export const RING_MAX_SHOWN = 12;
/** replicas a request waits for are slower than one: the k-th fastest of rf answers */
export const CONSISTENCY_LATENCY: Record<RingConsistency, number> = { one: 1, quorum: 1.15, all: 1.4 };
/** partitions above this size slow reads, compaction and repair down */
export const WIDE_PARTITION_MB = 100;
/** most of the traffic one partition key can take in the model */
export const MAX_HOT_SHARE = 90;
export const MAX_BUCKETS = 64;
/** reads a speculative retry at p99 adds: about one in a hundred is sent twice */
export const SPEC_RETRY_EXTRA = 0.01;
/** Cassandra's server-side timeouts (read_request_timeout, write_request_timeout), ms */
export const RING_TIMEOUTS = { read: 5000, write: 2000 };

export const isRingDb = (n: Pick<DesignNode, 'kind' | 'tech'>) => n.kind === 'db' && !!techProfile(n).ring;

/** Replicas a read or write must hear back from at a consistency level. */
export function consistencyCount(cl: RingConsistency, rf: number): number {
  return cl === 'one' ? 1 : cl === 'all' ? rf : Math.floor(rf / 2) + 1;
}

export interface RingConfig {
  nodes: number; rf: number; down: number;
  /** read consistency and the replicas a read waits for */
  cl: RingConsistency; k: number;
  /** write consistency and the replicas a write waits for */
  wcl: RingConsistency; kw: number;
  /** share of traffic on the hottest partition key, 0–0.9 */
  hot: number;
  buckets: number;
  partitionMb: number;
  specRetry: boolean;
}

/** What the engine reports for a ring database. */
export interface RingStat extends RingConfig, RingLoads {
  /** share of requests that cannot reach their consistency level (fail at once) */
  unavailable: number;
  /** share of reads right after a write that may miss it (R + W ≤ RF) */
  stale: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The ring of a node with defaults: an older design that used shards / replicas keeps the same
 * number of servers; the replication factor defaults to 3 (or fewer nodes); QUORUM by default.
 */
export function ringConfig(n: DesignNode): RingConfig {
  const D = dbConfig(n);
  const auto = Math.max(RING_MIN_NODES, D.shards * (1 + D.replicas));
  const nodes = clamp(D.nodes > 0 ? D.nodes : auto, 1, RING_MAX_NODES);
  const rf = clamp(D.rf > 0 ? D.rf : 3, 1, nodes);
  const cl = D.consistency ?? 'quorum', wcl = D.writeConsistency ?? 'quorum';
  return {
    nodes, rf, cl, k: consistencyCount(cl, rf), wcl, kw: consistencyCount(wcl, rf),
    down: clamp(D.downNodes ?? 0, 0, nodes),
    hot: clamp(D.hotShare ?? 0, 0, MAX_HOT_SHARE) / 100,
    buckets: Math.round(clamp(D.buckets ?? 1, 1, MAX_BUCKETS)),
    partitionMb: Math.max(0, D.partitionMb ?? 10),
    specRetry: D.specRetry ?? true,
  };
}

/** Partition size after bucketing: salting a key into b buckets splits its partition b ways. */
export const effectivePartitionMb = (r: Pick<RingConfig, 'partitionMb' | 'buckets'>) => r.partitionMb / r.buckets;

/** How much more a read costs on wide partitions: 1 up to 100 MB, then +50% per 100 MB. */
export function readPenalty(r: Pick<RingConfig, 'partitionMb' | 'buckets'>): number {
  const mb = effectivePartitionMb(r);
  return mb <= WIDE_PARTITION_MB ? 1 : 1 + (mb - WIDE_PARTITION_MB) / 200;
}

/**
 * Replica operations one request costs: writes go to every replica whatever the consistency level,
 * reads ask k of them (a little more with speculative retry, more on wide partitions).
 */
export const ringWork = (r: RingConfig, read: number) =>
  read * r.k * readPenalty(r) * (r.specRetry ? 1 + SPEC_RETRY_EXTRA : 1) + (1 - read) * r.rf;

/** Coordinator latency multiplier: reads wait for k replicas, writes for kw. */
export const ringLatencyFactor = (r: RingConfig, read: number) =>
  read * CONSISTENCY_LATENCY[r.cl] * readPenalty(r) + (1 - read) * CONSISTENCY_LATENCY[r.wcl];

/** Nodes that carry the hot key: its replicas, spread over more nodes by bucketing. */
export const hotNodeCount = (r: RingConfig) => {
  const live = r.nodes - r.down;
  return r.hot > 0 ? Math.min(live, r.rf * r.buckets) : live;
};

/** Each live node's share of all replica operations (the hottest node's share when skewed). */
const hotShareOf = (r: RingConfig) => {
  const live = r.nodes - r.down, m = hotNodeCount(r);
  return r.hot / m + (1 - r.hot) / live;
};

/** Requests/s the ring takes before its busiest node is full (failed nodes serve nothing). */
export function ringCapacity(r: RingConfig, perNode: number, read: number): number {
  if (r.nodes - r.down <= 0) return 0;
  return perNode / (ringWork(r, read) * hotShareOf(r));
}

export interface RingLoads {
  /** nodes carrying the hot key (all live nodes when traffic is even) */
  hotNodes: number;
  /** load of those nodes, and of the rest */
  hotLoad: number; coldLoad: number;
  /** share of replica operations dropped by overloaded nodes (they time out) */
  drop: number;
  /** requests/s before the busiest node is full */
  cap: number;
  /** replica operations per second on the busiest node */
  opsHot: number;
  /** share of those operations that are reads */
  readOps: number;
}

/** Load of every node of the ring at `inn` requests/s. */
export function ringNodeLoads(r: RingConfig, perNode: number, read: number, inn: number): RingLoads {
  const live = r.nodes - r.down, work = ringWork(r, read);
  const readWork = work - (1 - read) * r.rf;
  const readOps = work > 0 ? readWork / work : 0;
  if (live <= 0) return { hotNodes: 0, hotLoad: inn > 0 ? 9 : 0, coldLoad: inn > 0 ? 9 : 0, drop: 1, cap: 0, opsHot: 0, readOps };
  const m = hotNodeCount(r), ops = inn * work;
  const opsHot = ops * hotShareOf(r);
  const hotLoad = opsHot / perNode;
  const coldLoad = m < live ? (ops * (1 - r.hot)) / live / perNode : hotLoad;
  const total = m * hotLoad + (live - m) * coldLoad;
  const dropped = m * Math.max(0, hotLoad - 1) + (live - m) * Math.max(0, coldLoad - 1);
  return { hotNodes: m, hotLoad, coldLoad, drop: total > 0 ? dropped / total : 0, cap: ringCapacity(r, perNode, read), opsHot, readOps };
}

const choose = (n: number, k: number) => {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
};

/**
 * Share of rows (token ranges) that cannot reach `k` live replicas while `down` of `nodes` are
 * down. With virtual nodes each range's replicas are a spread-out set of `rf` nodes, so this is
 * the hypergeometric chance that more than rf − k of a range's replicas are among the failed ones.
 */
export function unavailableShare(nodes: number, rf: number, k: number, down: number): number {
  if (down <= 0) return 0;
  if (down >= nodes) return 1;
  const total = choose(nodes, rf);
  let bad = 0;
  for (let j = rf - k + 1; j <= Math.min(rf, down); j++) bad += choose(down, j) * choose(nodes - down, rf - j);
  return total > 0 ? Math.min(1, bad / total) : 0;
}

/** Requests that fail at once: reads at the read level, writes at the write level. */
export const ringUnavailable = (r: RingConfig, read: number) =>
  read * unavailableShare(r.nodes, r.rf, r.k, r.down) + (1 - read) * unavailableShare(r.nodes, r.rf, r.kw, r.down);

/**
 * Chance that a read right after a write misses it: the k replicas read share none of the kw
 * that acknowledged the write. Zero whenever R + W > RF (the sets must overlap).
 */
export function staleReadShare(rf: number, k: number, kw: number): number {
  if (k + kw > rf) return 0;
  return choose(rf - kw, k) / choose(rf, k);
}

/** Nodes that can fail at once without any row losing its consistency level (the stricter of reads and writes). */
export const toleratedFailures = (r: Pick<RingConfig, 'rf' | 'k'> & { kw?: number }) => r.rf - Math.max(r.k, r.kw ?? r.k);

/** Radius of the drawn ring for `shown` nodes. */
export const ringRadius = (shown: number) => Math.max(120, shown * 15);

/** Where the ring's nodes are drawn around the database's anchor, starting at the top. */
export function ringLayout(n: DesignNode): Point[] {
  const shown = Math.min(ringConfig(n).nodes, RING_MAX_SHOWN), r = ringRadius(shown);
  return Array.from({ length: shown }, (_, i) => {
    const a = -Math.PI / 2 + (i / shown) * Math.PI * 2;
    return { x: Math.round(n.x + Math.cos(a) * r), y: Math.round(n.y + Math.sin(a) * r) };
  });
}
