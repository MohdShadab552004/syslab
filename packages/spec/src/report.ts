import type { DesignDoc } from '@syslab/types';
import { EMPTY_RUNTIME, LB_ALGOS, OVERLOAD, fmtCompact, fmtMoney, fmtMs, lbConfig, simulate, stepRuntime, type Runtime } from '@syslab/sim';

export interface SimulationReport {
  users: number;
  requestsPerSecond: number;
  p95Ms: number | null;
  latencyTargetMs: number;
  meetsLatencyTarget: boolean;
  errorRatePercent: number;
  monthlyCostUsd: number;
  overloaded: { component: string; loadPercent: number }[];
  busiest: { component: string; loadPercent: number } | null;
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
  let rt: Runtime = { ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {}, spike: opts.spike ?? 1 };
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
  const queues = d.nodes.filter((n) => n.kind === 'queue' && sim.queue[n.id]).map((n) => ({
    component: n.label, waitingMessages: Math.round(sim.queue[n.id].depth), changePerSecond: Math.round(sim.queue[n.id].growth),
  }));
  const loadBalancers = d.nodes.filter((n) => n.kind === 'lb' && sim.lbBackends[n.id]?.length).map((n) => {
    const algo = LB_ALGOS.find((a) => a.key === lbConfig(n).algo)?.name ?? '';
    const split = sim.lbBackends[n.id].filter((b) => !b.down)
      .map((b) => `${name(b.nodeId)}${(sim.reps[b.nodeId] ?? 1) > 1 ? ` #${b.replica + 1}` : ''} ${Math.round(b.share * 100)}%`).join(', ');
    return { component: n.label, algorithm: algo, split };
  });

  const slo = d.requirements.slo;
  const p95 = sim.rps > 0 ? Math.round(sim.p95) : null;
  const lines = [
    `Traffic: ${fmtCompact(sim.users)} concurrent users${(opts.spike ?? 1) > 1 ? ` (spike ×${opts.spike})` : ''} → ${fmtCompact(sim.rps)} requests/s.`,
    `P95 latency: ${p95 == null ? '— (no traffic)' : fmtMs(p95)} vs target ${slo} ms → ${p95 == null || p95 <= slo ? 'OK' : 'TOO SLOW'}.`,
    `Errors: ${(sim.errorRate * 100).toFixed(1)}%. Cost: ${fmtMoney(sim.cost)}/month.`,
    overloaded.length ? `Overloaded: ${overloaded.map((o) => `${o.component} ${o.loadPercent}%`).join(', ')}.` : busiest ? `No component is overloaded; busiest is ${busiest.component} at ${busiest.loadPercent}%.` : 'No traffic, so nothing is loaded.',
    ...(scaling.length ? [`Autoscaling during the first ${seconds}s: ${scaling.slice(-6).join('; ')}.`] : []),
    ...queues.map((q) => `Queue ${q.component}: ${fmtCompact(q.waitingMessages)} waiting, ${q.changePerSecond > 0 ? `growing +${fmtCompact(q.changePerSecond)}/s` : q.changePerSecond < 0 ? `draining ${fmtCompact(-q.changePerSecond)}/s` : 'steady'}.`),
    ...loadBalancers.map((l) => `${l.component} (${l.algorithm}): ${l.split}.`),
    ...(d.nodes.every((n) => n.kind !== 'users') ? ['Note: there is no users component, so the design receives no traffic.'] : []),
  ];
  return {
    users: sim.users, requestsPerSecond: Math.round(sim.rps), p95Ms: p95, latencyTargetMs: slo,
    meetsLatencyTarget: p95 == null || p95 <= slo,
    errorRatePercent: Math.round(sim.errorRate * 1000) / 10, monthlyCostUsd: Math.round(sim.cost),
    overloaded, busiest, scaling, queues, loadBalancers, text: lines.join('\n'),
  };
}
