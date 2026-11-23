import type { DesignDoc, DesignNode, RingConsistency } from '@syslab/types';
import {
  MAX_BUCKETS, MAX_HOT_SHARE, RING_MAX_NODES, RING_MIN_NODES, RING_TIMEOUTS, WIDE_PARTITION_MB,
  effectivePartitionMb, fmtCompact, fmtInt, readPenalty, ringConfig, ringNodeLoads, staleReadShare, toleratedFailures,
  type RingStat, type SimResult,
} from '@syslab/sim';
import type { EditorActions } from './editor.store';
import type { OptionView, StepperView } from './useInspector';

/** One thread pool of the busiest node, like a line of `nodetool tpstats`. */
export interface StageView { name: string; ops: string; pending: string; dropped: string; bad: boolean }

export interface RingView {
  nodes: StepperView;
  rf: StepperView;
  readCl: OptionView[];
  writeCl: OptionView[];
  /** R + W > RF or not */
  consistency: { text: string; bad: boolean };
  down: StepperView;
  hotShare: StepperView;
  buckets: StepperView;
  partitionMb: StepperView;
  specRetry: { on: boolean; onToggle: () => void };
  stages: StageView[];
  /** errors per second by kind */
  errors: { label: string; value: string; bad: boolean }[];
  status: { text: string; bad: boolean };
  hint: string;
  loadHint: string;
}

const CL_OPTIONS: [RingConsistency, string, string][] = [
  ['one', 'ONE', '1 replica, fastest'], ['quorum', 'QUORUM', 'majority'], ['all', 'ALL', 'every replica, fragile'],
];
const PARTITION_STEPS = [1, 10, 50, 100, 200, 500, 1000, 2000];
const pct = (v: number) => `${Math.max(1, Math.round(v * 100))}%`;
const s = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** The Ring cluster card of a ring database (Cassandra). */
export function ringView(n: DesignNode, doc: DesignDoc, sim: SimResult, a: EditorActions): RingView {
  const id = n.id, cfg = ringConfig(n);
  const r: RingStat = sim.ring?.[id] ?? { ...cfg, ...ringNodeLoads(cfg, 1, 0.9, 0), unavailable: 0, stale: staleReadShare(cfg.rf, cfg.k, cfg.kw) };
  const up = (patch: Parameters<EditorActions['updateDb']>[1]) => a.updateDb(id, patch);
  const opts = (cur: RingConsistency, set: (v: RingConsistency) => void): OptionView[] =>
    CL_OPTIONS.map(([v, label, sub]) => ({ key: v, label, sub, active: v === cur, onSelect: () => set(v) }));
  const tol = toleratedFailures(r), CL = r.cl.toUpperCase(), WCL = r.wcl.toUpperCase();
  const live = r.nodes - r.down, hotPct = Math.round(r.hot * 100), mb = effectivePartitionMb(r);
  const read = (doc.requirements?.read ?? 90) / 100, inn = sim.inflow[id] ?? 0;

  // Little's law on the busiest node: operations waiting = rate × time in line
  const wait = sim.waitMs[id] ?? 0, over = Math.max(0, 1 - 1 / Math.max(1, r.hotLoad));
  const stage = (name: string, ops: number): StageView => ({
    name, ops: `${fmtCompact(ops)}/s`, pending: fmtInt(Math.round((ops * wait) / 1000)), dropped: `${fmtCompact(ops * over)}/s`, bad: over > 0,
  });
  const timeouts = inn * (1 - r.unavailable) * r.drop;

  const ladder = (v: number, dir: 1 | -1) => {
    const list = dir > 0 ? PARTITION_STEPS : [...PARTITION_STEPS].reverse();
    return list.find((x) => (dir > 0 ? x > v : x < v)) ?? v;
  };

  return {
    // a new node joins the ring and takes over a share of every other node's token ranges
    nodes: { value: r.nodes, onDec: () => up({ nodes: Math.max(RING_MIN_NODES, r.nodes - 1), downNodes: Math.min(r.down, r.nodes - 1) }), onInc: () => up({ nodes: Math.min(RING_MAX_NODES, r.nodes + 1) }) },
    rf: { value: r.rf, onDec: () => up({ rf: Math.max(1, r.rf - 1) }), onInc: () => up({ rf: Math.min(r.nodes, 5, r.rf + 1) }) },
    readCl: opts(r.cl, (v) => up({ consistency: v })),
    writeCl: opts(r.wcl, (v) => up({ writeConsistency: v })),
    consistency: r.stale > 0
      ? { text: `R ${r.k} + W ${r.kw} ≤ RF ${r.rf} · up to ${pct(r.stale)} stale`, bad: true }
      : { text: `R ${r.k} + W ${r.kw} > RF ${r.rf} · consistent`, bad: false },
    down: { value: r.down, onDec: () => up({ downNodes: Math.max(0, r.down - 1) }), onInc: () => up({ downNodes: Math.min(r.nodes, r.down + 1) }) },
    hotShare: { value: `${hotPct}%`, onDec: () => up({ hotShare: Math.max(0, hotPct - 10) }), onInc: () => up({ hotShare: Math.min(MAX_HOT_SHARE, hotPct + 10) }) },
    buckets: { value: r.buckets, onDec: () => up({ buckets: Math.max(1, Math.floor(r.buckets / 2)) }), onInc: () => up({ buckets: Math.min(MAX_BUCKETS, r.buckets * 2) }) },
    partitionMb: { value: `${fmtInt(r.partitionMb)} MB`, onDec: () => up({ partitionMb: ladder(r.partitionMb, -1) }), onInc: () => up({ partitionMb: ladder(r.partitionMb, 1) }) },
    specRetry: { on: r.specRetry, onToggle: () => up({ specRetry: !r.specRetry }) },
    stages: [stage('ReadStage', r.opsHot * r.readOps), stage('MutationStage', r.opsHot * (1 - r.readOps))],
    errors: [
      { label: 'UnavailableException', value: `${fmtCompact(inn * r.unavailable)}/s`, bad: r.unavailable > 0 },
      { label: 'Read / WriteTimeout', value: `${fmtCompact(timeouts * read)}/s · ${fmtCompact(timeouts * (1 - read))}/s`, bad: timeouts > 0 },
    ],
    status: r.unavailable > 0
      ? { text: `${pct(r.unavailable)} of requests unavailable`, bad: true }
      : { text: tol > 0 ? `survives ${tol} ${s(tol, 'node')} down` : 'no node may fail', bad: r.down > tol },
    hint: `Every row lives on ${r.rf} of the ${r.nodes} nodes. Reads wait for ${r.k} (${CL}), writes for ${r.kw} (${WCL}), though every write still goes to all ${r.rf}.`
      + (r.stale > 0
        ? ` R + W ≤ RF, so a read right after a write can miss it (up to ${pct(r.stale)}). Raise either level until R + W > RF.`
        : ' R + W > RF, so every read overlaps the latest write.')
      + ` Up to ${tol} ${s(tol, 'node')} can fail without losing requests.`
      + (r.down > 0 ? ` ${r.down} ${s(r.down, 'node is', 'nodes are')} down now${r.unavailable > 0 ? `: requests whose replicas include too many failed nodes fail at once (UnavailableException).` : ', and every row still has enough live replicas.'}` : ''),
    loadHint: (r.hot > 0
      ? `${hotPct}% of traffic hits one partition key, so its ${r.hotNodes} replica ${s(r.hotNodes, 'node')} ${r.hotNodes === live ? 'cover the whole ring' : `run at ${pct(r.hotLoad)} while the other ${live - r.hotNodes} run at ${pct(r.coldLoad)}`}.${r.buckets > 1 ? ` Salting it into ${r.buckets} buckets spreads it over more nodes.` : ' Salt the key into buckets (user_id + bucket) to spread it.'} `
      : 'Traffic is spread evenly over the ring. ')
      + (mb > WIDE_PARTITION_MB ? `Partitions of ${fmtInt(Math.round(mb))} MB make each read ${readPenalty(r).toFixed(1)}× dearer; keep them under ${WIDE_PARTITION_MB} MB. ` : '')
      + (r.specRetry ? 'Speculative retry (99p) sends a slow read to another replica: about 1% more reads, a shorter P99. ' : 'Without speculative retry, one slow replica sets the P99. ')
      + `Overloaded nodes time out after ${RING_TIMEOUTS.read / 1000} s (reads) or ${RING_TIMEOUTS.write / 1000} s (writes).`,
  };
}
