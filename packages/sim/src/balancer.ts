import type { LbAlgorithm } from '@syslab/types';

/** One server replica a load balancer can send to. */
export interface Backend {
  /** stable id: `${nodeId}:${replica}` — used as the hash-ring key */
  key: string;
  nodeId: string;
  edgeId: string;
  replica: number;
  /** requests/sec one replica can serve */
  cap: number;
  /** base latency of the backend, ms (for least connections) */
  lat: number;
  /** concurrent workers of one replica (for least connections) */
  workers: number;
  /** connection weight (weighted round robin) */
  weight: number;
}

export const LB_ALGOS: { key: LbAlgorithm; name: string; sub: string; hint: string }[] = [
  {
    key: 'rr', name: 'Round robin', sub: 'take turns',
    hint: 'Sends request 1 to server A, 2 to B, 3 to C, then back to A. Every server gets the same share, no matter how big or busy it is. Simple and fair when all servers are identical; a smaller server gets overloaded first.',
  },
  {
    key: 'wrr', name: 'Weighted', sub: 'by weight',
    hint: 'Round robin, but a server with weight 3 gets three turns for every one turn of a weight-1 server. Use it when servers have different sizes: give bigger machines a higher weight.',
  },
  {
    key: 'lc', name: 'Least connections', sub: 'fewest open',
    hint: 'Each new request goes to the server with the fewest open connections. When a server slows down, its requests pile up and it gets fewer new ones, so the LB adapts on its own. At low traffic, or with identical servers, it splits like round robin; give the servers different sizes to see it adapt.',
  },
  {
    key: 'hash', name: 'IP hash', sub: 'sticky clients',
    hint: 'hash(client IP) picks the server, so the same user always lands on the same server (sticky sessions, warm local cache). Uses a consistent-hash ring: if a server dies, only its users move, to the next server on the ring. The split is uneven; more virtual nodes make it smoother.',
  },
];

/** 32-bit FNV-1a plus a murmur3 finalizer (so near-identical keys spread over the ring). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Consistent hashing: each backend owns `vnodes` points on a ring [0,1).
 * A client hashes to a spot and goes to the next point clockwise, so each backend's
 * share is the total arc length that ends at its points.
 */
function ringShares(bs: Backend[], vnodes: number): number[] {
  const pts: { p: number; i: number }[] = [];
  bs.forEach((b, i) => {
    for (let v = 0; v < vnodes; v++) pts.push({ p: fnv1a(`${b.key}#${v}`) / 2 ** 32, i });
  });
  pts.sort((a, b) => a.p - b.p);
  const share = bs.map(() => 0);
  pts.forEach((pt, j) => {
    const prev = j === 0 ? pts[pts.length - 1].p - 1 : pts[j - 1].p;
    share[pt.i] += pt.p - prev;
  });
  return share;
}

/**
 * Least connections at steady state. By Little's law, open connections = rps × latency,
 * and latency grows as a server runs hot. The LB keeps connections equal, so we solve for
 * the split where rps_i × latency_i is the same on every backend.
 */
function leastConnShares(bs: Backend[], sent: number, latency: (b: Backend, rps: number) => number): number[] {
  const conns = (rps: number, b: Backend) => rps * latency(b, rps);
  /** rps a backend takes when its connection count is K (conns is increasing in rps) */
  const rpsAt = (b: Backend, K: number) => {
    if (conns(sent, b) <= K) return sent;
    let lo = 0, hi = sent;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (conns(m, b) < K) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  let lo = 0, hi = Math.max(...bs.map((b) => conns(sent, b)));
  for (let i = 0; i < 40; i++) {
    const K = (lo + hi) / 2;
    const total = bs.reduce((s, b) => s + rpsAt(b, K), 0);
    if (total < sent) lo = K; else hi = K;
  }
  const rps = bs.map((b) => rpsAt(b, (lo + hi) / 2));
  const sum = rps.reduce((s, x) => s + x, 0);
  return sum > 0 ? rps.map((x) => x / sum) : bs.map(() => 1 / bs.length);
}

/** Fraction of `sent` traffic each backend receives. Shares sum to 1 (or are empty). */
export function balance(
  algo: LbAlgorithm, bs: Backend[], sent: number, vnodes: number, latency: (b: Backend, rps: number) => number,
): number[] {
  if (!bs.length) return [];
  if (algo === 'wrr') {
    const sum = bs.reduce((s, b) => s + b.weight, 0);
    return bs.map((b) => (sum > 0 ? b.weight / sum : 1 / bs.length));
  }
  if (algo === 'lc') return sent > 0 ? leastConnShares(bs, sent, latency) : bs.map(() => 1 / bs.length);
  if (algo === 'hash') return ringShares(bs, Math.max(1, Math.round(vnodes)));
  return bs.map(() => 1 / bs.length);
}
