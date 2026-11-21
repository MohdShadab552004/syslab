'use client';

import { useMemo } from 'react';
import type { DesignDoc, DesignEdge, DesignNode, EdgeOp, LbAlgorithm, PartitionStrategy, Protocol, ShardStrategy } from '@syslab/types';
import {
  GROUP_COLORS, ICONS, KINDS, LB_ALGOS, SIZES, TECHS, congestion, dbConfig, fmtCompact, fmtInt, fmtMoney, isHorizontalAuto,
  isOver, isVerticalAuto, lbConfig, QUEUE_MAX, type SimResult,
} from '@syslab/sim';
import { canRewire, useEditorStore, type EdgeEnd, type EditorActions } from './editor.store';
import { groupMembers } from '@/lib/canvas/groups';
import { useSimulation } from './useSimulation';

/* ---------- generic option model, rendered by <OptionGroup> ---------- */
export interface OptionView { key: string; label: string; sub?: string; active: boolean; onSelect: () => void }
export interface StepperView { value: string | number; onDec: () => void; onInc: () => void }
export interface LoadView { pct: string; width: number; color: string }

const opts = <T extends string | number | boolean>(
  list: [T, string, string?][], current: T, onSelect: (v: T) => void,
): OptionView[] => list.map(([v, label, sub]) => ({ key: String(v), label, sub, active: v === current, onSelect: () => onSelect(v) }));

const loadView = (v: number, down: boolean): LoadView => ({
  pct: down ? 'offline' : Math.round(v * 100) + '%',
  width: down ? 0 : Math.min(100, Math.round(v * 100)),
  color: down ? '#9a9a95' : isOver(v) ? '#e5484d' : v >= 0.7 ? '#e09a2c' : '#4f86c9',
});

/* ---------- views ---------- */
export interface NodeInspectorView {
  id: string;
  kindName: string;
  icon: string;
  tile: string;
  state: { text: string; bad: boolean };
  name: string;
  onRename: (v: string) => void;
  tech: { value: string; options: string[]; onChange: (v: string) => void };
  needsLB: { onAdd: () => void } | null;
  sizes: OptionView[] | null;
  autoscale: {
    on: boolean;
    onToggle: () => void;
    modes: OptionView[];
    hint: string;
    horizontal: { min: StepperView; max: StepperView } | null;
    vertical: { min: StepperView; max: StepperView } | null;
    targets: OptionView[];
    status: string;
  } | null;
  db: {
    replicas: StepperView;
    syncModes: OptionView[] | null;
    replicaHint: string;
    shards: StepperView;
    sharding: { key: string; onKey: (v: string) => void; strategies: OptionView[] } | null;
    shardHint: string;
    partitions: OptionView[];
    partition: { key: string; onKey: (v: string) => void; count: StepperView } | null;
    partitionHint: string;
    writeLoad: string;
    readLoad: string;
  } | null;
  lb: {
    algos: OptionView[];
    hint: string;
    vnodes: OptionView[] | null;
    backends: { key: string; label: string; share: string; rps: string; load: LoadView; weight: StepperView | null; down: boolean }[];
    spread: { text: string; bad: boolean };
    empty: boolean;
  } | null;
  queue: {
    waiting: string;
    fill: LoadView;
    inRate: string;
    outRate: string;
    drainCap: string;
    trend: { text: string; bad: boolean };
    hint: string;
    max: string;
    onPurge: (() => void) | null;
  } | null;
  replicas: StepperView | null;
  stats: { incoming: string; capacity: string; load: LoadView; latency: string; cost: string } | null;
  connections: { key: string; text: string; onRemove: () => void }[];
  downLabel: string;
  onToggleDown: () => void;
  onDelete: () => void;
}

export interface EndSelectView { value: string; options: { value: string; label: string; disabled?: boolean }[]; onChange: (v: string) => void }

export interface EdgeInspectorView {
  title: string;
  ends: { from: EndSelectView; to: EndSelectView };
  modes: OptionView[];
  protocols: OptionView[];
  ops: OptionView[];
  route: { value: string; onChange: (v: string) => void } | null;
  weight: StepperView;
  weightNote: string | null;
  share: string;
  rps: string;
  onSlowPath: string;
  onReverse: () => void;
  onDelete: () => void;
}

export interface GroupInspectorView {
  label: string;
  onRename: (v: string) => void;
  collapsed: boolean;
  contents: string;
  onToggleCollapse: () => void;
  colors: { key: string; name: string; swatch: string; active: boolean; onSelect: () => void }[];
  onDelete: () => void;
}

export interface RequirementsView {
  goal: string; onGoal: (v: string) => void;
  dau: number; onDau: (v: number) => void;
  peaks: OptionView[];
  read: number; readText: string; onRead: (v: number) => void;
  slo: number; onSlo: (v: number) => void;
  dataNote: string; onDataNote: (v: string) => void;
}

export interface TrafficView { slider: number; onSlider: (v: number) => void; presets: OptionView[] }

export type InspectorView =
  | { kind: 'none'; lesson: boolean; requirements: RequirementsView; traffic: TrafficView }
  | { kind: 'node'; node: NodeInspectorView }
  | { kind: 'edge'; edge: EdgeInspectorView }
  | { kind: 'group'; group: GroupInspectorView }
  | { kind: 'note'; onDelete: () => void }
  | { kind: 'multi'; multi: MultiInspectorView };

export interface MultiInspectorView {
  title: string;
  parts: string;
  links: number;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/* ---------- builders ---------- */
function nodeView(n: DesignNode, doc: DesignDoc, sim: SimResult, a: EditorActions): NodeInspectorView {
  const k = KINDS[n.kind], id = n.id, ld = sim.load[id] ?? 0;
  const hot = !n.down && isOver(ld), busy = !n.down && ld >= 0.7;
  const auto = isHorizontalAuto(n), autoV = isVerticalAuto(n), as = n.autoscale;
  const byId = sim.byId;

  const autoscale: NodeInspectorView['autoscale'] = k.canAuto ? {
    on: as.on,
    onToggle: () => a.updateAutoscale(id, { on: !as.on }, true),
    modes: opts<'h' | 'v'>([['h', 'Horizontal', 'more servers'], ['v', 'Vertical', 'bigger server']], as.mode, (m) => a.updateAutoscale(id, { mode: m }, true)),
    hint: autoV
      ? 'Resizes this one machine up or down. No load balancer needed, but it stops at 192 vCPU and every resize is a short restart.'
      : 'Adds or removes identical servers behind a load balancer. Scales almost without limit; servers drain before removal.',
    horizontal: auto ? {
      min: { value: as.min, onDec: () => a.updateAutoscale(id, { min: Math.max(1, as.min - 1) }), onInc: () => a.updateAutoscale(id, { min: Math.min(as.max, as.min + 1) }) },
      max: { value: as.max, onDec: () => a.updateAutoscale(id, { max: Math.max(as.min, as.max - 1) }), onInc: () => a.updateAutoscale(id, { max: Math.min(50, as.max + 1) }) },
    } : null,
    vertical: autoV ? {
      min: { value: `${SIZES[as.minSize].cpu} vCPU`, onDec: () => a.updateAutoscale(id, { minSize: Math.max(0, as.minSize - 1) }), onInc: () => a.updateAutoscale(id, { minSize: Math.min(as.maxSize, as.minSize + 1) }) },
      max: { value: `${SIZES[as.maxSize].cpu} vCPU`, onDec: () => a.updateAutoscale(id, { maxSize: Math.max(as.minSize, as.maxSize - 1) }), onInc: () => a.updateAutoscale(id, { maxSize: Math.min(SIZES.length - 1, as.maxSize + 1) }) },
    } : null,
    targets: opts([50, 60, 70, 80].map((t) => [t, `${t}%`] as [number, string]), as.target, (t) => a.updateAutoscale(id, { target: t })),
    status: (() => {
      if (autoV) {
        const cur = sim.sizeIdx[id], want = sim.desiredSize[id];
        return `${SIZES[cur].cpu} vCPU${want != null && want !== cur ? (want > cur ? ' · growing' : ' · shrinking') : hot ? ' · at max size' : ' · steady'}`;
      }
      if (sim.needsLB[id]) return 'blocked: no load balancer';
      const have = sim.reps[id], want = sim.desiredReps[id];
      return auto ? `×${have}${want != null && want !== have ? (want > have ? ` · scaling out to ${want}` : ` · scaling in to ${want}`) : ' · steady'}` : '';
    })(),
  } : null;

  let db: NodeInspectorView['db'] = null;
  if (n.kind === 'db') {
    const D = dbConfig(n), dl = sim.dbLoad[id] ?? { w: 0, r: 0 }, N = D.shards, key = D.shardKey || 'key', pkey = D.partKey || 'key';
    db = {
      replicas: { value: D.replicas, onDec: () => a.updateDb(id, { replicas: Math.max(0, D.replicas - 1) }), onInc: () => a.updateDb(id, { replicas: Math.min(5, D.replicas + 1) }) },
      syncModes: D.replicas > 0 ? opts<boolean>([[false, 'Async', 'fast writes, small lag'], [true, 'Sync', 'no lag, slower writes']], D.sync, (v) => a.updateDb(id, { sync: v })) : null,
      replicaHint: !D.replicas
        ? 'No replicas: the primary handles every read and write. Add replicas for read-heavy apps.'
        : D.sync ? 'Every write waits until replicas confirm (+6 ms). Reads are never stale.'
        : `Writes go to the primary, reads spread across ${D.replicas} replica${D.replicas > 1 ? 's' : ''}. Replicas lag ~40 ms, so a read right after a write can be stale.`,
      shards: { value: N, onDec: () => a.updateDb(id, { shards: Math.max(1, N - 1) }), onInc: () => a.updateDb(id, { shards: Math.min(8, N + 1) }) },
      sharding: N > 1 ? {
        key: D.shardKey, onKey: (v) => a.updateDb(id, { shardKey: v }),
        strategies: opts<ShardStrategy>([['hash', 'Hash'], ['range', 'Range'], ['geo', 'Geo']], D.strategy, (v) => a.updateDb(id, { strategy: v })),
      } : null,
      shardHint: N > 1
        ? ({ hash: `Each row goes to hash(${key}) % ${N}. Even spread, but range scans hit every shard.`, range: `Rows split by ${key} ranges. Range queries are cheap, but a hot range can overload one shard.`, geo: 'Rows live in the shard nearest the user. Fast per region, cross-region queries are slow.' }[D.strategy]) + ` Write capacity is now ×${N}.`
        : 'One shard holds all the data. Shard when writes or data size outgrow a single primary.',
      partitions: opts<PartitionStrategy>([['none', 'None'], ['time', 'By time'], ['list', 'By list'], ['hash', 'By hash']], D.partition, (v) => a.updateDb(id, { partition: v })),
      partition: D.partition !== 'none' ? {
        key: D.partKey, onKey: (v) => a.updateDb(id, { partKey: v }),
        count: { value: D.parts, onDec: () => a.updateDb(id, { parts: Math.max(2, D.parts - 1) }), onInc: () => a.updateDb(id, { parts: Math.min(48, D.parts + 1) }) },
      } : null,
      partitionHint: D.partition === 'none'
        ? 'Partitioning splits one big table inside the same database, e.g. one partition per month. Unlike sharding it stays on one server.'
        : ({ time: `One partition per period of ${pkey}. Old months can be archived or dropped instantly.`, list: `Rows grouped by a value of ${pkey}, like country or status.`, hash: `Rows spread across ${D.parts} partitions by hash(${pkey}).` }[D.partition]) + ` Queries that filter on ${pkey} scan less, ~30% faster.`,
      writeLoad: loadView(dl.w, n.down).pct,
      readLoad: loadView(dl.r, n.down).pct,
    };
  }

  let lb: NodeInspectorView['lb'] = null;
  if (n.kind === 'lb') {
    const L = lbConfig(n), list = sim.lbBackends[id] ?? [];
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const live = list.filter((b) => !b.down).map((b) => sim.repLoad[b.nodeId]?.[b.replica] ?? 0);
    const hi = live.length ? Math.max(...live) : 0, lo = live.length ? Math.min(...live) : 0;
    const ratio = lo > 0 ? hi / lo : hi > 0 ? Infinity : 1;
    lb = {
      algos: LB_ALGOS.map((x) => ({ key: x.key, label: x.name, sub: x.sub, active: L.algo === x.key, onSelect: () => a.updateLb(id, { algo: x.key as LbAlgorithm }) })),
      hint: LB_ALGOS.find((x) => x.key === L.algo)?.hint ?? '',
      vnodes: L.algo === 'hash' ? opts<number>([[1, '1'], [10, '10'], [100, '100']], L.vnodes, (v) => a.updateLb(id, { vnodes: v })) : null,
      backends: list.map((b) => {
        const t = byId.get(b.nodeId)!, e = doc.edges.find((x) => x.id === b.edgeId);
        const multi = (sim.reps[b.nodeId] ?? 1) > 1, w = e?.weight || 1;
        return {
          key: `${b.edgeId}:${b.replica}`,
          label: multi ? `${t.label} ${LETTERS[b.replica] ?? b.replica + 1}` : t.label,
          share: b.down ? '—' : `${Math.round(b.share * 100)}%`,
          rps: `${fmtCompact(b.rps)} rps`,
          load: loadView(sim.repLoad[b.nodeId]?.[b.replica] ?? 0, b.down),
          weight: L.algo === 'wrr' && b.replica === 0 && e
            ? { value: w, onDec: () => a.updateEdge(e.id, { weight: Math.max(1, w - 1) }), onInc: () => a.updateEdge(e.id, { weight: Math.min(10, w + 1) }) }
            : null,
          down: b.down,
        };
      }),
      spread: live.length < 2
        ? { text: 'One backend: nothing to balance', bad: false }
        : hi < 0.05 ? { text: 'Idle', bad: false }
        : ratio < 1.15 ? { text: 'Even', bad: false }
        : { text: ratio === Infinity ? 'One server gets nothing' : `Busiest is ${ratio.toFixed(1)}× the quietest`, bad: isOver(hi) },
      empty: !list.length,
    };
  }

  let queue: NodeInspectorView['queue'] = null;
  if (n.kind === 'queue') {
    const q = sim.queue[id];
    const depth = q?.depth ?? 0, growth = q?.growth ?? 0;
    const fill = depth > 0.5 ? Math.log10(1 + depth) / Math.log10(1 + QUEUE_MAX) : 0;
    const noConsumer = !!q && q.consumers === 0;
    queue = {
      waiting: `${fmtInt(depth)} messages`,
      fill: { pct: `${Math.round((depth / QUEUE_MAX) * 1000) / 10}% full`, width: Math.round(fill * 100), color: q?.full ? '#e5484d' : growth > 0.5 ? '#e09a2c' : growth < -0.5 ? '#3f9b6b' : '#4f86c9' },
      inRate: `${fmtCompact(q?.inRate ?? 0)} msg/s`,
      outRate: `${fmtCompact(q?.outRate ?? 0)} msg/s`,
      drainCap: noConsumer ? 'no consumer' : q?.drainCap === Infinity ? '∞' : `${fmtCompact(q?.drainCap ?? 0)} msg/s`,
      trend: n.down ? { text: 'offline', bad: true }
        : q?.full ? { text: 'Full · rejecting new messages', bad: true }
        : growth > 0.5 ? { text: `Growing +${fmtCompact(growth)}/s`, bad: true }
        : growth < -0.5 ? { text: `Draining · empty in ~${Math.max(1, Math.ceil(depth / -growth))}s`, bad: false }
        : { text: depth > 0.5 ? 'Steady' : 'Empty', bad: false },
      hint: noConsumer
        ? 'Nothing reads this queue, so every message waits forever. Connect it to a worker.'
        : q?.full ? 'The queue hit its limit and is now rejecting messages (errors). Add or enlarge consumers, then purge if old messages no longer matter.'
        : growth > 0.5 ? 'Producers are faster than consumers. Nothing is lost yet, but messages wait longer every second. Add workers (or autoscale them), or the queue fills up.'
        : growth < -0.5 ? 'Consumers are faster than producers now, so the backlog is shrinking.'
        : 'Consumers keep up: messages leave as fast as they arrive. Try a traffic spike to see the queue absorb it.',
      max: fmtCompact(QUEUE_MAX),
      onPurge: depth > 0.5 ? () => a.purgeQueue(id) : null,
    };
  }

  const connections = doc.edges
    .filter((e) => (e.from === id || e.to === id) && byId.has(e.from) && byId.has(e.to))
    .map((e) => ({
      key: e.id,
      text: `${e.from === id ? '→ ' + byId.get(e.to)!.label : '← ' + byId.get(e.from)!.label} · ${e.proto}`,
      onRemove: () => a.deleteEdge(e.id),
    }));

  return {
    id,
    kindName: k.name,
    icon: ICONS[n.kind],
    tile: k.tile ?? k.colors[1],
    state: { text: n.down ? 'Offline' : hot ? 'Overloaded' : busy ? 'Busy' : 'Healthy', bad: n.down || hot },
    name: n.label,
    onRename: (v) => a.updateNode(id, { label: v }),
    tech: { value: n.tech, options: !n.tech || TECHS[n.kind].includes(n.tech) ? TECHS[n.kind] : [n.tech, ...TECHS[n.kind]], onChange: (v) => a.updateNode(id, { tech: v }) },
    needsLB: sim.needsLB[id] ? { onAdd: () => a.addLoadBalancer(id) } : null,
    sizes: k.perCpu && !autoV ? SIZES.map((s, i) => ({
      key: String(i), label: `${s.cpu} vCPU · ${s.ram} GB`, sub: `${fmtMoney(s.cost * (k.costMul ?? 1))}/mo`, active: n.size === i, onSelect: () => a.updateNode(id, { size: i }),
    })) : null,
    autoscale,
    db,
    lb,
    queue,
    replicas: n.kind !== 'users' && !auto && n.kind !== 'db'
      ? { value: n.replicas, onDec: () => a.updateNode(id, { replicas: Math.max(1, n.replicas - 1) }), onInc: () => a.updateNode(id, { replicas: Math.min(20, n.replicas + 1) }) }
      : null,
    stats: n.kind === 'users' ? null : {
      incoming: `${fmtCompact(sim.inflow[id] ?? 0)} rps`,
      capacity: sim.cap[id] === Infinity ? '∞' : `${fmtCompact(sim.cap[id] ?? 0)} rps`,
      load: loadView(ld, n.down),
      latency: k.async ? 'async' : `${Math.round(sim.nodeLatency[id] ?? k.lat * congestion(ld))} ms`,
      cost: fmtMoney(sim.nodeCost[id] ?? 0),
    },
    connections,
    downLabel: n.down ? 'Bring online' : 'Take offline',
    onToggleDown: () => a.toggleDown(id),
    onDelete: () => a.deleteNode(id),
  };
}

function edgeView(e: DesignEdge, doc: DesignDoc, sim: SimResult, a: EditorActions): EdgeInspectorView {
  const from = sim.byId.get(e.from)!, to = sim.byId.get(e.to)!;
  const sumW = doc.edges.filter((x) => x.from === e.from && sim.byId.has(x.to)).reduce((s, x) => s + (x.weight || 1), 0) || 1;
  const w = e.weight || 1;
  const lbAlgo = from.kind === 'lb' ? lbConfig(from).algo : null;
  const lbTotal = lbAlgo ? doc.edges.filter((x) => x.from === e.from).reduce((s, x) => s + (sim.edgeRps[x.id] ?? 0), 0) : 0;
  // same label twice (e.g. two "Server"s)? add the kind so the dropdown stays readable
  const counts = new Map<string, number>();
  doc.nodes.forEach((n) => counts.set(n.label, (counts.get(n.label) ?? 0) + 1));
  const endSelect = (end: EdgeEnd): EndSelectView => ({
    value: e[end],
    options: doc.nodes.map((n) => ({
      value: n.id,
      label: (counts.get(n.label) ?? 0) > 1 ? `${n.label} (${KINDS[n.kind].name})` : n.label,
      disabled: n.id !== e[end] && !canRewire(doc, e.id, end, n.id),
    })),
    onChange: (v) => a.rewireEdge(e.id, end, v),
  });
  return {
    title: `${from.label} → ${to.label}`,
    ends: { from: endSelect('from'), to: endSelect('to') },
    modes: opts([['sync', 'Sync (waits)'], ['async', 'Async (fire & forget)']], e.mode, (v) => a.updateEdge(e.id, { mode: v })),
    protocols: opts<Protocol>((['REST', 'gRPC', 'WebSocket', 'Webhook', 'TCP', 'Pub/Sub'] as Protocol[]).map((p) => [p, p]), e.proto, (v) => a.updateEdge(e.id, { proto: v })),
    ops: opts<EdgeOp>([['read', 'Reads'], ['write', 'Writes'], ['both', 'Both']], e.op, (v) => a.updateEdge(e.id, { op: v })),
    route: from.kind === 'gateway' ? { value: e.route, onChange: (v) => a.updateEdge(e.id, { route: v }) } : null,
    weight: { value: w, onDec: () => a.updateEdge(e.id, { weight: Math.max(1, w - 1) }), onInc: () => a.updateEdge(e.id, { weight: Math.min(10, w + 1) }) },
    weightNote: lbAlgo && lbAlgo !== 'wrr' ? `Weight is only used when ${from.label} runs Weighted round robin. Its algorithm decides the split.` : null,
    share: lbAlgo
      ? `${Math.round(((sim.edgeRps[e.id] ?? 0) / (lbTotal || 1)) * 100)}% of ${from.label}`
      : `${Math.round((w / sumW) * 100)}% of ${from.label}`,
    rps: `${fmtCompact(sim.edgeRps[e.id] ?? 0)} rps`,
    onSlowPath: e.mode === 'async' ? 'No (async)' : sim.onSlowPath[e.id] ? 'Yes, slowest path' : 'No',
    onReverse: () => a.reverseEdge(e.id),
    onDelete: () => a.deleteEdge(e.id),
  };
}

const USER_PRESETS: [number, string][] = [[1000, '1K'], [40000, '40K'], [100000, '100K'], [500000, '500K'], [2000000, '2M'], [10000000, '10M']];

/** Inspector content for whatever is selected, or the requirements when nothing is. */
export function useInspector(): InspectorView | null {
  const doc = useEditorStore((s) => s.doc);
  const sel = useEditorStore((s) => s.ui.sel);
  const multi = useEditorStore((s) => s.ui.multi);
  const a = useEditorStore((s) => s.actions);
  const sim = useSimulation();

  return useMemo<InspectorView | null>(() => {
    if (!doc || !sim) return null;
    if (multi.length > 1) {
      const c = (t: string) => multi.filter((p) => p.type === t).length;
      const nIds = new Set(multi.filter((p) => p.type === 'node').map((p) => p.id));
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
      return {
        kind: 'multi',
        multi: {
          title: `${multi.length} items selected`,
          parts: [c('node') && plural(c('node'), 'component'), c('group') && plural(c('group'), 'group'), c('note') && plural(c('note'), 'note')].filter(Boolean).join(' · '),
          links: doc.edges.filter((e) => nIds.has(e.from) && nIds.has(e.to)).length,
          onCopy: () => { a.copySelection(); },
          onDuplicate: () => { a.duplicateSelection(); },
          onDelete: () => { a.deleteSelection(); },
        },
      };
    }
    if (sel?.type === 'node') {
      const n = doc.nodes.find((x) => x.id === sel.id);
      if (n) return { kind: 'node', node: nodeView(n, doc, sim, a) };
    }
    if (sel?.type === 'edge') {
      const e = doc.edges.find((x) => x.id === sel.id);
      if (e && sim.byId.has(e.from) && sim.byId.has(e.to)) return { kind: 'edge', edge: edgeView(e, doc, sim, a) };
    }
    if (sel?.type === 'group') {
      const g = doc.groups.find((x) => x.id === sel.id);
      if (g) return {
        kind: 'group',
        group: {
          label: g.label, onRename: (v) => a.updateGroup(g.id, { label: v }),
          collapsed: !!g.collapsed,
          contents: (() => { const m = groupMembers(doc, g); return `${m.nodes.length} components · ${m.notes.length} notes${m.groups.length ? ` · ${m.groups.length} groups` : ''}`; })(),
          onToggleCollapse: () => a.toggleGroupCollapsed(g.id),
          colors: (Object.keys(GROUP_COLORS) as (keyof typeof GROUP_COLORS)[]).map((c) => ({
            key: c, name: GROUP_COLORS[c].name, swatch: GROUP_COLORS[c].swatch, active: g.color === c, onSelect: () => a.setGroupColor(g.id, c),
          })),
          onDelete: () => a.deleteGroup(g.id),
        },
      };
    }
    if (sel?.type === 'note' && doc.notes.some((t) => t.id === sel.id)) return { kind: 'note', onDelete: () => a.deleteNote(sel.id) };

    const r = doc.requirements;
    return {
      kind: 'none',
      lesson: !!doc.lesson,
      requirements: {
        goal: r.goal, onGoal: (v) => a.setRequirements({ goal: v }),
        dau: r.dau, onDau: (v) => a.setRequirements({ dau: Math.max(0, v || 0) }),
        peaks: opts([5, 10, 20, 50].map((p) => [p, `${p}%`] as [number, string]), r.peak, (p) => a.setRequirements({ peak: p })),
        read: r.read, readText: `${r.read}% reads · ${100 - r.read}% writes`, onRead: (v) => a.setRequirements({ read: v }),
        slo: r.slo, onSlo: (v) => a.setRequirements({ slo: Math.max(1, v || 1) }),
        dataNote: r.dataNote, onDataNote: (v) => a.setRequirements({ dataNote: v }),
      },
      traffic: {
        // log scale: 1K .. 10M users over 0..80
        slider: Math.max(0, Math.min(80, Math.round(20 * Math.log10(Math.max(doc.users, 1) / 1000)))),
        onSlider: (v) => {
          const raw = 1000 * Math.pow(10, v / 20), mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
          a.setUsers(Math.round(raw / mag) * mag);
        },
        presets: opts(USER_PRESETS, doc.users, (u) => a.setUsers(u)),
      },
    };
  }, [doc, sel, multi, sim, a]);
}
