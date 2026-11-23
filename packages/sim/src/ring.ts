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

export const isRingDb = (n: Pick<DesignNode, 'kind' | 'tech'>) => n.kind === 'db' && !!techProfile(n).ring;

/** Replicas a read or write must hear back from at a consistency level. */
export function consistencyCount(cl: RingConsistency, rf: number): number {
  return cl === 'one' ? 1 : cl === 'all' ? rf : Math.floor(rf / 2) + 1;
}

export interface RingConfig { nodes: number; rf: number; cl: RingConsistency; k: number; down: number }

/**
 * The ring of a node with defaults: an older design that used shards / replicas keeps the same
 * number of servers; the replication factor defaults to 3 (or fewer nodes); QUORUM by default.
 */
export function ringConfig(n: DesignNode): RingConfig {
  const D = dbConfig(n);
  const auto = Math.max(RING_MIN_NODES, D.shards * (1 + D.replicas));
  const nodes = Math.max(1, Math.min(RING_MAX_NODES, D.nodes > 0 ? D.nodes : auto));
  const rf = Math.max(1, Math.min(nodes, D.rf > 0 ? D.rf : 3));
  const cl = D.consistency ?? 'quorum';
  return { nodes, rf, cl, k: consistencyCount(cl, rf), down: Math.max(0, Math.min(nodes, D.downNodes ?? 0)) };
}

/** Replica operations one request costs: writes go to every replica, reads ask k of them. */
export const ringWork = (r: RingConfig, read: number) => read * r.k + (1 - read) * r.rf;

/** Requests/s the ring can serve with `perNode` capacity per node (failed nodes serve nothing). */
export const ringCapacity = (r: RingConfig, perNode: number, read: number) => ((r.nodes - r.down) * perNode) / ringWork(r, read);

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

/** Nodes that can fail at once without any row losing its consistency level. */
export const toleratedFailures = (r: Pick<RingConfig, 'rf' | 'k'>) => r.rf - r.k;

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
