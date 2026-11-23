import type { DesignDoc } from '@syslab/types';
import { CACHE_HIT, EMPTY_RUNTIME, LB_ALGOS, cacheConfig, costBreakdown, OVERLOAD, fmtCompact, fmtMoney, fmtMs, lbConfig, simulate, stepRuntime, type Runtime, type SimResult } from '@syslab/sim';

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
  queues: { component: string; mode: 'pubsub' | 'work'; waitingMessages: number; changePerSecond: number; subscribers: { component: string; behindMessages: number; changePerSecond: number }[] }[];
  loadBalancers: { component: string; algorithm: string; split: string }[];
  /** how the run evolved: one point every 5 seconds (and the last one) */
  timeline: { second: number; requestsPerSecond: number; p95Ms: number | null; errorRatePercent: number; instances: number; queueBacklog: number; monthlyCostUsd: number }[];
  /** the monthly bill at AWS list prices: by category, biggest items, and standard ways to save */
  cost: {
    totalUsd: number;
    source: string;
    byCategory: { category: string; usd: number }[];
    topItems: { component: string; usd: number; detail: string }[];
    savings: { text: string; usd: number }[];
  };
  text: string;
}

/** One point of the report timeline. */
function point(d: DesignDoc, sim: SimResult, second: number) {
  let instances = 0, queueBacklog = 0;
  for (const n of d.nodes) {
    if (n.kind === 'app' || n.kind === 'worker' || n.kind === 'cache') instances += sim.reps[n.id] ?? 1;
    if (n.kind === 'queue') queueBacklog += sim.queue[n.id]?.depth ?? 0;
  }
  return {
    second, requestsPerSecond: Math.round(sim.rps), p95Ms: sim.rps > 0 ? Math.round(sim.p95) : null,
    errorRatePercent: Math.round(sim.errorRate * 1000) / 10, instances, queueBacklog: Math.round(queueBacklog), monthlyCostUsd: Math.round(sim.cost),
  };
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
  const timeline: SimulationReport['timeline'] = [];
  for (let t = 0; t < seconds; t++) {
    const now = simulate(d, rt);
    if (t % 5 === 0) timeline.push(point(d, now, t));
    const step = stepRuntime(d, now, rt, t * 1000);
    if (!step) break;
    rt = step.runtime;
    for (const ev of step.events) if (!ev.text.startsWith('Draining')) scaling.push(`t=${t + 1}s ${ev.text}`);
  }
  const sim = simulate(d, rt);
  const end = timeline.length ? Math.max(seconds, timeline[timeline.length - 1].second) : seconds;
  if (!timeline.length || timeline[timeline.length - 1].second !== end) timeline.push(point(d, sim, end));
  const bill = costBreakdown(d, sim);
  const cost: SimulationReport['cost'] = {
    totalUsd: Math.round(bill.total), source: bill.source,
    byCategory: bill.byCategory.map((c) => ({ category: c.category, usd: Math.round(c.monthly) })),
    topItems: bill.items.filter((i) => i.monthly > 0).slice(0, 8).map((i) => ({ component: i.label, usd: Math.round(i.monthly), detail: i.detail })),
    savings: bill.savings.slice(0, 6).map((s) => ({ text: s.text, usd: Math.round(s.monthly) })),
  };
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
    mode: sim.queue[n.id].mode,
    subscribers: sim.queue[n.id].subscribers.map((s) => ({ component: name(s.nodeId), behindMessages: Math.round(s.lag), changePerSecond: Math.round(s.growth) })),
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
  for (const n of d.nodes) {
    const r = sim.ring?.[n.id];
    if (r && r.down > 0) {
      issues.push(r.unavailable > 0
        ? `${n.label}: ${r.down} of ${r.nodes} nodes down, so ${Math.max(1, Math.round(r.unavailable * 100))}% of rows can't reach ${r.cl.toUpperCase()} (RF ${r.rf} tolerates ${r.rf - r.k}). Bring nodes back, lower the consistency level or raise the replication factor.`
        : `${n.label}: ${r.down} of ${r.nodes} nodes down; every row still reaches ${r.cl.toUpperCase()} (RF ${r.rf}).`);
    }
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
    `P95 latency: ${p95 == null ? '— (no traffic)' : fmtMs(p95)} vs target ${slo} ms → ${p95 == null || p95 <= slo ? 'OK' : 'TOO SLOW'}.${p95 == null ? '' : ` (mean ${fmtMs(mean!)}, P99 ${fmtMs(p99!)})`}${sim.fastFailRate > 0.05 ? ` Latency only counts answered requests: ${Math.round(sim.fastFailRate * 100)}% were rejected instantly by an open circuit breaker.` : ''}`,
    `Errors: ${(sim.errorRate * 100).toFixed(1)}%. Cost: ${fmtMoney(sim.cost)}/month (${bill.source}).`,
    ...(cost.byCategory.length ? [`Cost by category: ${cost.byCategory.map((c) => `${c.category} ${fmtMoney(c.usd)}`).join(', ')}.`] : []),
    ...(cost.savings.length ? [`Ways to save (each estimated alone): ${cost.savings.slice(0, 3).map((s) => `${s.text} −${fmtMoney(s.usd)}/mo`).join('; ')}.`] : []),
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
    ...queues.map((q) => {
      const trend = (v: number) => (v > 0 ? `growing +${fmtCompact(v)}/s` : v < 0 ? `draining ${fmtCompact(-v)}/s` : 'steady');
      if (q.mode === 'pubsub') {
        const behind = q.subscribers.filter((s) => s.behindMessages > 0 || s.changePerSecond > 0);
        return `Queue ${q.component} (pub/sub, every subscriber gets every message): ${q.subscribers.length} subscriber${q.subscribers.length === 1 ? '' : 's'}${behind.length ? `; behind: ${behind.map((s) => `${s.component} ${fmtCompact(s.behindMessages)} (${trend(s.changePerSecond)})`).join(', ')}` : ', all keeping up'}.`;
      }
      return `Queue ${q.component}: ${fmtCompact(q.waitingMessages)} waiting, ${trend(q.changePerSecond)}.`;
    }),
    ...loadBalancers.map((l) => `${l.component} (${l.algorithm}): ${l.split}.`),
    ...(d.nodes.every((n) => n.kind !== 'users') ? ['Note: there is no users component, so the design receives no traffic.'] : []),
  ];
  return {
    users: sim.users, requestsPerSecond: Math.round(sim.rps), p95Ms: p95, p99Ms: p99, meanLatencyMs: mean, latencyTargetMs: slo,
    meetsLatencyTarget: p95 == null || p95 <= slo,
    errorRatePercent: Math.round(sim.errorRate * 1000) / 10, monthlyCostUsd: Math.round(sim.cost),
    overloaded, busiest, components, issues, scaling, queues, loadBalancers, timeline, cost, text: lines.join('\n'),
  };
}
