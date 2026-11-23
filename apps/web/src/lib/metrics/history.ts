import type { DesignDoc } from '@syslab/types';
import { fmtCompact, fmtMoney, fmtMs, type SimResult } from '@syslab/sim';

/** One second of a running simulation, kept for the graphs. */
export interface Sample {
  /** wall-clock time, ms */
  t: number;
  /** requests/s offered and actually answered */
  rps: number;
  served: number;
  p95: number;
  p99: number;
  /** 0..1 */
  errors: number;
  /** monthly cost at this moment, $ */
  cost: number;
  /** all running instances of app / worker / cache nodes */
  replicas: number;
  /** messages waiting across all queues (slowest subscriber for pub/sub) */
  backlog: number;
  /** per node: load (1 = full) and mean latency, ms */
  load: Record<string, number>;
  latency: Record<string, number>;
  /** autoscaling events that happened this second */
  events: string[];
}

/** Five minutes at one sample per second. */
export const HISTORY_MAX = 300;

export function sampleOf(doc: Pick<DesignDoc, 'nodes'>, sim: SimResult, t: number, events: string[] = []): Sample {
  const load: Record<string, number> = {}, latency: Record<string, number> = {};
  let replicas = 0, backlog = 0;
  for (const n of doc.nodes) {
    if (n.kind === 'users') continue;
    load[n.id] = Math.round((sim.load[n.id] ?? 0) * 1000) / 1000;
    latency[n.id] = Math.round((sim.nodeLatency[n.id] ?? 0) * 10) / 10;
    if (n.kind === 'app' || n.kind === 'worker' || n.kind === 'cache') replicas += sim.reps[n.id] ?? 1;
    if (n.kind === 'queue') backlog += sim.queue[n.id]?.depth ?? 0;
  }
  return {
    t, rps: sim.rps, served: sim.rps * (1 - sim.errorRate), p95: sim.rps > 0 ? sim.p95 : 0, p99: sim.rps > 0 ? sim.p99 : 0,
    errors: sim.errorRate, cost: sim.cost, replicas, backlog, load, latency, events,
  };
}

/** Append a sample, keeping the last `max`. */
export function pushSample(history: Sample[], s: Sample, max = HISTORY_MAX): Sample[] {
  const next = history.length >= max ? history.slice(history.length - max + 1) : history.slice();
  next.push(s);
  return next;
}

/** A small time-series chart: what the metrics panel draws. */
export interface ChartView {
  key: string;
  title: string;
  /** latest value, formatted */
  value: string;
  /** main series and an optional faint second series (e.g. offered vs. served traffic) */
  points: number[];
  secondary: number[] | null;
  /** top of the y axis */
  max: number;
  /** a target line, e.g. the latency SLO */
  threshold: { value: number; label: string } | null;
  /** sample indexes where something happened (autoscaling) */
  marks: number[];
  /** the latest value is a problem */
  bad: boolean;
  /** formatted top of the axis */
  maxText: string;
}

const top = (xs: number[], floor = 0) => {
  const m = Math.max(floor, ...xs);
  return m > 0 ? m * 1.1 : 1;
};

/** The charts of the metrics panel, from the recorded history. */
export function buildCharts(h: Sample[], slo: number): ChartView[] {
  const last = h[h.length - 1];
  const col = (f: (s: Sample) => number) => h.map(f);
  const marks = h.flatMap((s, i) => (s.events.length ? [i] : []));
  const rps = col((s) => s.rps), served = col((s) => s.served);
  const p95 = col((s) => s.p95), p99 = col((s) => s.p99);
  const errors = col((s) => s.errors * 100);
  const replicas = col((s) => s.replicas), backlog = col((s) => s.backlog), cost = col((s) => s.cost);
  const chart = (c: Omit<ChartView, 'maxText'>, fmt: (v: number) => string): ChartView => ({ ...c, maxText: fmt(c.max) });
  return [
    chart({ key: 'tput', title: 'Throughput (answered / offered)', value: last ? `${fmtCompact(last.served)} rps` : '—', points: served, secondary: rps, max: top(rps), threshold: null, marks, bad: !!last && last.served < last.rps * 0.98 }, (v) => `${fmtCompact(v)}`),
    chart({ key: 'p95', title: 'Latency P95 (P99 faint)', value: last ? fmtMs(last.p95) : '—', points: p95, secondary: p99, max: top(p99, slo), threshold: { value: slo, label: `SLO ${slo} ms` }, marks, bad: !!last && last.p95 > slo }, fmtMs),
    chart({ key: 'err', title: 'Errors', value: last ? `${(last.errors * 100).toFixed(last.errors > 0 && last.errors < 0.1 ? 1 : 0)}%` : '—', points: errors, secondary: null, max: top(errors, 1), threshold: null, marks, bad: !!last && last.errors > 0.0005 }, (v) => `${Math.round(v)}%`),
    chart({ key: 'reps', title: 'Instances running', value: last ? String(last.replicas) : '—', points: replicas, secondary: null, max: top(replicas, 1), threshold: null, marks, bad: false }, (v) => String(Math.round(v))),
    chart({ key: 'backlog', title: 'Queue backlog', value: last ? `${fmtCompact(last.backlog)} msgs` : '—', points: backlog, secondary: null, max: top(backlog, 1), threshold: null, marks, bad: !!last && h.length > 1 && last.backlog > h[h.length - 2].backlog + 0.5 }, (v) => fmtCompact(v)),
    chart({ key: 'cost', title: 'Cost / month', value: last ? fmtMoney(last.cost) : '—', points: cost, secondary: null, max: top(cost, 1), threshold: null, marks, bad: false }, fmtMoney),
  ];
}

/** Load and latency of one node over the last `n` samples (for the inspector). */
export function nodeTrend(h: Sample[], id: string, n = 120): { load: number[]; latency: number[] } | null {
  const tail = h.slice(-n).filter((s) => s.load[id] != null);
  if (tail.length < 2) return null;
  return { load: tail.map((s) => s.load[id]), latency: tail.map((s) => s.latency[id] ?? 0) };
}

/** "−2m 30s" style label for the left edge of a chart covering `h`. */
export function spanLabel(h: Sample[]): string {
  if (h.length < 2) return '';
  const s = Math.round((h[h.length - 1].t - h[0].t) / 1000);
  return s >= 60 ? `−${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `−${s}s`;
}
