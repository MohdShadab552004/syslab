/**
 * Queueing model for one server: M/M/c (Erlang C).
 *
 * A server is `c` workers (threads, connections, cores...) that each take `serviceMs` per request.
 * Requests that find every worker busy wait in line. Erlang C gives the chance of waiting and the
 * wait-time distribution, so latency rises smoothly with load and explodes near 100%, the way real
 * servers behave. A big pool (c = 100) barely notices 85% load; a small one (c = 4) already queues.
 */

/** Probability that a request has to wait: Erlang C with c workers and offered load a = λ·S. */
export function erlangC(c: number, a: number): number {
  if (a <= 0) return 0;
  if (a >= c) return 1;
  // Erlang B by the stable recursion B(k) = a·B(k-1) / (k + a·B(k-1)), then convert to C.
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const rho = a / c;
  return b / (1 - rho * (1 - b));
}

/** Requests above this utilisation are treated as hitting the wall: the line only grows. */
const MAX_RHO = 0.995;

export interface QueueTimes {
  /** chance a request waits at all */
  pWait: number;
  /** mean time in line, ms */
  meanWait: number;
  /** 95th / 99th percentile time in line, ms */
  p95Wait: number;
  p99Wait: number;
}

const ZERO: QueueTimes = { pWait: 0, meanWait: 0, p95Wait: 0, p99Wait: 0 };

/**
 * Wait times for a server with `c` workers, `serviceMs` per request, running at utilisation `rho`
 * (1 = every worker always busy). Above ~100% the numbers are capped; the overflow is counted as
 * dropped requests elsewhere.
 */
export function queueTimes(c: number, serviceMs: number, rho: number): QueueTimes {
  if (!(serviceMs > 0) || !(rho > 0) || !Number.isFinite(rho)) return ZERO;
  const w = Math.max(1, Math.round(c));
  const r = Math.min(rho, MAX_RHO);
  const pWait = erlangC(w, r * w);
  // Wait time given a wait is exponential with rate (c·μ − λ) = c(1 − ρ)/S.
  const scale = serviceMs / (w * (1 - r));
  const quantile = (q: number) => (pWait > 1 - q ? scale * Math.log(pWait / (1 - q)) : 0);
  return { pWait, meanWait: pWait * scale, p95Wait: quantile(0.95), p99Wait: quantile(0.99) };
}

/**
 * Service times vary a little request to request (cache misses, GC, disk). These multiply the mean
 * service time to get its 95th / 99th percentile; lighter-tailed than exponential, like real servers.
 */
export const SERVICE_P95 = 1.6;
export const SERVICE_P99 = 2.3;

/** Number of workers that explains a capacity: c = capacity (req/s) × service time (s). */
export const workersFor = (capacityRps: number, serviceMs: number) =>
  Number.isFinite(capacityRps) && capacityRps > 0 && serviceMs > 0 ? Math.max(1, Math.round((capacityRps * serviceMs) / 1000)) : 1;
