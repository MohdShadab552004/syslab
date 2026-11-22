import type { DesignDoc } from '@syslab/types';
import { CACHE_HIT, EMPTY_RUNTIME, LB_ALGOS, cacheConfig, OVERLOAD, fmtCompact, fmtMoney, fmtMs, lbConfig, simulate, stepRuntime, type Runtime } from '@syslab/sim';

export interface SimulationReport {
  users: number;
  requestsPerSecond: number;
  p95Ms: number | null;
  p99Ms: number | null;
  meanLatencyMs: number | null;
  latencyTargetMs: number;
  meetsLatencyTarget: boolean;
  errorRatePercent: number;
  monthlyCostUsd: number;
  overloaded: { component: string; loadPercent: number }[];
  busiest: { component: string; loadPercent: number } | null;
  /** every component except users: traffic it receives and how full it is */
  components: { component: string; kind: string; requestsPerSecond: number; loadPercent: number; latencyMs: number; offline: boolean }[];
  /** problems that are not plain overload: connection limits, retry storms, open breakers */
  issues: string[];
  scaling: string[];
  queues: { component: string; waitingMessages: number; changePerSecond: number }[];
  loadBalancers: { component: string; algorithm: string; split: string }[];
  text: string;
}

/**
 * Run the simulation the way the editor would after the traffic settles: autoscalers get up to
 * `seconds` ticks to react and queues fill or drain for that long. Returns plain numbers plus a
 * short human/LLM-readable text.
 */
export function simulationReport(doc: DesignDoc, opts: { users?: number; spike?: number; seconds?: number } = {}): SimulationReport {
  const d: DesignDoc = opts.users != null ? { ...doc, users: Math.max(0, Math.round(opts.users)) } : doc;
  let rt: Runtime = { ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {}, cacheHit: {}, spike: opts.spike ?? 1 };
  const scaling: string[] = [];
  const seconds = Math.min(300, Math.max(0, opts.seconds ?? 60));
  for (let t = 0; t < seconds; t++) {
    const step = stepRuntime(d, simulate(d, rt), rt, t * 1000);
    if (!step) break;
    rt = step.runtime;
    for (const ev of step.events) if (!ev.text.startsWith('Draining')) scaling.push(`t=${t + 1}s ${ev.text}`);
  }
  const sim = simulate(d, rt);
  const name = (id: string) => sim.byId.get(id)?.label ?? id;
  const live = d.nodes.filter((n) => n.kind !== 'users' && !n.down);
  const overloaded = live.filter((n) => (sim.load[n.id] ?? 0) > OVERLOAD)
    .map((n) => ({ component: n.label, loadPercent: Math.round((sim.load[n.id] ?? 0) * 100) }))
    .sort((a, b) => b.loadPercent - a.loadPercent);
  const top = [...live].sort((a, b) => (sim.load[b.id] ?? 0) - (sim.load[a.id] ?? 0))[0];
  const busiest = top && sim.rps > 0 ? { component: top.label, loadPercent: Math.round((sim.load[top.id] ?? 0) * 100) } : null;
  const components = live.concat(d.nodes.filter((n) => n.down)).map((n) => ({
    component: n.label, kind: n.kind, requestsPerSecond: Math.round(sim.inflow[n.id] ?? 0),
    loadPercent: n.down ? 0 : Math.round((sim.load[n.id] ?? 0) * 100), latencyMs: Math.round((sim.nodeLatency[n.id] ?? 0) * 10) / 10, offline: !!n.down,
  }));
  const queues = d.nodes.filter((n) => n.kind === 'queue' && sim.queue[n.id]).map((n) => ({
    component: n.label, waitingMessages: Math.round(sim.queue[n.id].depth), changePerSecond: Math.round(sim.queue[n.id].growth),
  }));
  const loadBalancers = d.nodes.filter((n) => n.kind === 'lb' && sim.lbBackends[n.id]?.length).map((n) => {
    const algo = LB_ALGOS.find((a) => a.key === lbConfig(n).algo)?.name ?? '';
    const split = sim.lbBackends[n.id].filter((b) => !b.down)
      .map((b) => `${name(b.nodeId)}${(sim.reps[b.nodeId] ?? 1) > 1 ? ` #${b.replica + 1}` : ''} ${Math.round(b.share * 100)}%`).join(', ');
    return { component: n.label, algorithm: algo, split };
  });

  const issues: string[] = [];
  for (const n of d.nodes) {
    const c = sim.dbConns[n.id];
    if (c && c.need > c.limit) issues.push(`${n.label} has too many connections: ${c.need} needed (${c.need / 10} app/worker instances × 10) but only ${c.limit} allowed, so ${Math.round((1 - c.limit / c.need) * 100)}% of its queries are refused. Set database.maxConnections (10000 = a pooler like PgBouncer) or add read replicas.`);
  }
  for (const e of d.edges) {
    const from = name(e.from), to = name(e.to);
    if (sim.breakerOpen[e.id]) issues.push(`Circuit breaker ${from} → ${to} is open: calls fail fast while ${to} recovers.`);
    else if ((sim.retryAmp[e.id] ?? 1) > 1.05) issues.push(`Retries on ${from} → ${to} multiply its traffic ×${(sim.retryAmp[e.id]).toFixed(1)} because ${to} is dropping requests (retry storm). Fix the capacity of ${to}, or add a circuit breaker.`);
  }
  const slo = d.requirements.slo;
  const p95 = sim.rps > 0 ? Math.round(sim.p95) : null;
  const p99 = sim.rps > 0 ? Math.round(sim.p99) : null;
  const mean = sim.rps > 0 ? Math.round(sim.meanLatency) : null;
  const lines = [
    `Traffic: ${fmtCompact(sim.users)} concurrent users${(opts.spike ?? 1) > 1 ? ` (spike ×${opts.spike})` : ''} → ${fmtCompact(sim.rps)} requests/s.`,
    `P95 latency: ${p95 == null ? '— (no traffic)' : fmtMs(p95)} vs target ${slo} ms → ${p95 == null || p95 <= slo ? 'OK' : 'TOO SLOW'}.${p95 == null ? '' : ` (mean ${fmtMs(mean!)}, P99 ${fmtMs(p99!)})`}`,
    `Errors: ${(sim.errorRate * 100).toFixed(1)}%. Cost: ${fmtMoney(sim.cost)}/month.`,
    overloaded.length ? `Overloaded: ${overloaded.map((o) => `${o.component} ${o.loadPercent}%`).join(', ')}.` : busiest ? `No component is overloaded; busiest is ${busiest.component} at ${busiest.loadPercent}%.` : 'No traffic, so nothing is loaded.',
    ...issues,
    ...(sim.rps > 0 && components.length ? [`Per component: ${components.slice(0, 15).map((c) => `${c.component} ${c.offline ? 'OFFLINE' : `${fmtCompact(c.requestsPerSecond)} rps ${c.loadPercent}%`}`).join(', ')}${components.length > 15 ? ', …' : ''}.`] : []),
    ...d.nodes.filter((n) => n.kind === 'cache').flatMap((n) => {
      const h = Math.round((sim.cacheHit[n.id] ?? CACHE_HIT) * 100);
      if (n.down) return [sim.cacheBypass[n.id] ? `${n.label} is offline: its reads go to the database instead.` : `${n.label} is offline and nothing is behind it: its reads fail.`];
      if (sim.cacheRefill[n.id] === false) return [`${n.label}: the database behind it is offline, so expired keys cannot refill (TTL ${cacheConfig(n).ttl}s). Hit rate now ${h}%; misses and writes fail.`];
      if (h < Math.round(CACHE_HIT * 100)) return [`${n.label} is warming up: hit rate ${h}%, the rest miss and go to the database.`];
      return [];
    }),
    ...(scaling.length ? [`Autoscaling during the first ${seconds}s: ${scaling.slice(-6).join('; ')}.`] : []),
    ...queues.map((q) => `Queue ${q.component}: ${fmtCompact(q.waitingMessages)} waiting, ${q.changePerSecond > 0 ? `growing +${fmtCompact(q.changePerSecond)}/s` : q.changePerSecond < 0 ? `draining ${fmtCompact(-q.changePerSecond)}/s` : 'steady'}.`),
    ...loadBalancers.map((l) => `${l.component} (${l.algorithm}): ${l.split}.`),
    ...(d.nodes.every((n) => n.kind !== 'users') ? ['Note: there is no users component, so the design receives no traffic.'] : []),
  ];
  return {
    users: sim.users, requestsPerSecond: Math.round(sim.rps), p95Ms: p95, p99Ms: p99, meanLatencyMs: mean, latencyTargetMs: slo,
    meetsLatencyTarget: p95 == null || p95 <= slo,
    errorRatePercent: Math.round(sim.errorRate * 1000) / 10, monthlyCostUsd: Math.round(sim.cost),
    overloaded, busiest, components, issues, scaling, queues, loadBalancers, text: lines.join('\n'),
  };
}
