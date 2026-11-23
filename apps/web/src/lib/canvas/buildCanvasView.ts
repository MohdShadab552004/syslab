import type { DesignDoc, DesignEdge, DesignNode, NodeKind, Shape, ArrowHead } from '@syslab/types';
import {
  CACHE_HIT, DB_REPLICA_SCALE, DOWN_COLORS, GROUP_COLORS, HOT_COLORS, ICONS, KINDS, REPLICA_COLORS, SIZES,
  LB_ALGOS, QUEUE_MAX, crowd, fmtCompact, isOver, dbConfig, dbLayout, fmtInt, instancePositions, isBalancer, isDbCluster, isFanned, isHorizontalAuto,
  isVerticalAuto, lbConfig, nodeScale, segment, type Point, type SimResult,
  RING_MAX_SHOWN, WIDE_PARTITION_MB, effectivePartitionMb, isRingDb, ringConfig, ringLayout, ringNodeLoads, staleReadShare,
} from '@syslab/sim';
import type { FlowPlayback, JourneyPlayback, Marquee, Pick, Selection, Tool } from '@/types/editor';
import { canRewire, type Rewire } from '@/hooks/editor/editor.store';
import { GROUP_CARD, cardCenter, cardLeft, collapsedOwners, groupMembers } from './groups';
import { traceJourney } from './trace';
import { DEFAULT_VIEW, curveRoute, elbowRoute, findHubs, focusSet, pointAlong, portOffsets, type Ends, type Route, type ViewPrefs } from './readability';

/* ------------------------------------------------------------------ */
/*  View models: plain data the canvas components render, no logic.   */
/* ------------------------------------------------------------------ */

export type Colors = [string, string, string];

export interface LoadPillView { pct: string; width: number; color: string; hot: boolean }

export interface InstanceView {
  key: string;
  dx: number;
  dy: number;
  shape: Shape;
  w: number;
  h: number;
  scale: number;
  colors: Colors;
  icon: string;
  label: string;
  bands: boolean;
  load: LoadPillView;
  below: { text: string; info: boolean } | null;
  draining: boolean;
}

/** How a queue draws its backlog: lit slots, moving messages, and a state for colour. */
export interface QueueVisual {
  /** message slots lit, 0..4 (log scale of the backlog) */
  filled: number;
  /** messages are moving through */
  flowing: boolean;
  /** seconds for one message to cross the queue */
  dur: string;
  state: 'empty' | 'steady' | 'growing' | 'draining' | 'full' | 'down';
}

export interface NodeView {
  id: string;
  kind: NodeKind;
  /** plain name, shown large when zoomed far out */
  name: string;
  left: number;
  top: number;
  w: number;
  h: number;
  shape: Shape;
  scale: number;
  colors: Colors;
  icon: string;
  label: string;
  dashed: boolean;
  bands: boolean;
  ghostStack: 0 | 1 | 2;
  people: { x: number; y: number; c: string }[];
  load: LoadPillView | null;
  below: { text: string; info: boolean } | null;
  warn: string | null;
  badge: string | null;
  selected: boolean;
  pending: boolean;
  hot: boolean;
  dim: boolean;
  crosshair: boolean;
  extras: InstanceView[];
  /** drop target state while an edge end is dragged over this node */
  drop?: 'ok' | 'bad' | null;
  queue: QueueVisual | null;
  /** the step a playing journey has just reached */
  tcur?: boolean;
  /** shared infrastructure this node calls, shown as chips instead of lines (and "N callers" on a hub) */
  chips: { key: string; text: string; hot: boolean }[];
}

/** tone: colour of a client (IP hash shows the same colour always reaching the same server) */
export interface PacketView { key: string; dur: string; delay: string; fail: boolean; tone?: number }

/** Small label on a load balancer → server line: share, weight, open connections… */
export interface LineTagView { text: string; x: number; y: number; hot: boolean }

export interface LineView {
  key: string;
  x: number;
  y: number;
  len: number;
  ang: number;
  arrowX: number;
  packets: PacketView[];
  retract: boolean;
  tag?: LineTagView;
  /** curved or elbow line: SVG path data and arrowhead (x / y / len / ang are then unused) */
  path?: { d: string; arrow: { x: number; y: number; ang: number }; start: { x: number; y: number; ang: number } };
  /** straight line: where the source's rim is along the line (for a tail end) */
  tailX: number;
}

export interface EdgeView {
  id: string;
  lines: LineView[];
  async: boolean;
  selected: boolean;
  dim: boolean;
  /** connected to the hovered or focused node: drawn stronger */
  hl: boolean;
  /** carries only reads: drawn lighter */
  read: boolean;
  /** merged connections into / out of a collapsed group: drawn thicker */
  weight: number;
  /** health of the target: busy (70%+) or failing lines are coloured */
  tone: 'ok' | 'busy' | 'fail';
  /** hovered: show a tooltip with the numbers */
  tip: string | null;
  /** the hop a playing journey is on right now */
  tcur?: boolean;
  label: string;
  showLabel: boolean;
  labelX: number;
  labelY: number;
  /** drag handles at both ends (selected edge only) */
  handles: { from: Point; to: Point } | null;
  /** how the target end and the source end are drawn */
  head: ArrowHead;
  tail: ArrowHead;
}

/** Dashed line from the fixed end of a connection to the cursor while its other end is dragged. */
export interface RewireView { x: number; y: number; len: number; ang: number; dotX: number; dotY: number; valid: boolean }

/** sync: synchronous replica; gossip: the chatter between the nodes of a ring database */
export interface ReplicationLineView extends LineView { sync: boolean; gossip?: boolean }

export interface FlowSegmentView { key: string; x: number; y: number; len: number; ang: number; state: 'past' | 'cur' | 'next' | 'rec'; token: boolean }

export interface GroupSummaryView { parts: string; status: string; bad: boolean; traffic: string }
export interface GroupView {
  id: string; x: number; y: number; w: number; h: number; label: string; border: string; bg: string; selected: boolean;
  collapsed: boolean;
  /** what a collapsed card shows */
  summary: GroupSummaryView | null;
}

export interface NoteView { id: string; x: number; y: number; text: string; selected: boolean; open: boolean }

/** The journey of the selected component, for the playback bar. */
export interface JourneyView { focus: string; label: string; steps: number; idx: number | null; playing: boolean; caption: string }

export interface CanvasView {
  journey: JourneyView | null;
  nodes: NodeView[];
  edges: EdgeView[];
  replication: ReplicationLineView[];
  flow: FlowSegmentView[];
  groups: GroupView[];
  notes: NoteView[];
  rewire: RewireView | null;
  /** selection box, world coordinates */
  marquee: { x: number; y: number; w: number; h: number } | null;
}

export interface CanvasUi {
  sel: Selection;
  pending: string | null;
  tool: Tool;
  recording: string | null;
  flowPlay: FlowPlayback | null;
  running: boolean;
  drain: Record<string, number>;
  isLesson: boolean;
  rewire: Rewire | null;
  /** read-only viewers get no drag handles */
  readOnly?: boolean;
  multi?: Pick[];
  marquee?: Marquee | null;
  /** node under the pointer: its hidden lines show and its connections light up */
  hover?: string | null;
  /** connection under the pointer: it lights up, the others fade */
  hoverEdge?: string | null;
  /** journey playback of the selected component */
  journeyPlay?: JourneyPlayback | null;
  view?: ViewPrefs;
}

const LETTERS = 'ABCDEFGH';
/** nodes of a ring database are drawn smaller than the database itself */
export const RING_NODE_SCALE = 0.6;
const GEO = ['India', 'US', 'EU', 'APAC'];

function loadPill(v: number, down: boolean): LoadPillView {
  const hot = !down && isOver(v);
  return {
    pct: down ? 'offline' : Math.round(v * 100) + '%',
    width: down ? 0 : Math.min(100, Math.round(v * 100)),
    color: down ? '#9a9a95' : hot ? '#e5484d' : v >= 0.7 ? '#e09a2c' : '#4f86c9',
    hot,
  };
}

/** Below this a line is idle: less than one request every two seconds is not worth animating. */
const MIN_VISIBLE_RPS = 0.5;
const TONES = 6;

/** share of a line's requests that fail: all of them into an offline node, the overflow into an overloaded one */
const failShare = (down: boolean, bypassed: boolean, load: number) => (down ? (bypassed ? 0 : 1) : isOver(load) ? Math.min(1, Math.max(0, 1 - 1 / load)) : 0);

function packets(rps: number, async: boolean, fail: number, keyPrefix: string): PacketView[] {
  const cnt = rps < MIN_VISIBLE_RPS ? 0 : rps > 5000 ? 4 : rps > 500 ? 3 : 2;
  const dur = Math.max(0.9, Math.min(2.6, 2.8 - Math.log10(rps + 1) * 0.38)) * (async ? 1.4 : 1);
  return Array.from({ length: cnt }, (_, i) => ({
    key: `${keyPrefix}-${i}`,
    dur: dur.toFixed(2),
    delay: (-(i * dur) / cnt).toFixed(2),
    fail: fail > 0 && i < Math.max(1, Math.round(cnt * fail)),
  }));
}

/**
 * Packets from a load balancer to one backend, drawn so the algorithm is visible:
 * density follows the backend's share; round robin / weighted staggers backends so
 * requests visibly take turns; IP hash colours each backend's clients consistently.
 */
function lbPackets(rps: number, share: number, idx: number, n: number, algo: string, dur: number, fail: number, keyPrefix: string): PacketView[] {
  if (rps < MIN_VISIBLE_RPS || share <= 0) return [];
  const cnt = Math.max(1, Math.min(8, Math.round(share * 8)));
  const turn = algo === 'rr' || algo === 'wrr' ? (idx * dur) / (cnt * Math.max(1, n)) : 0;
  return Array.from({ length: cnt }, (_, j) => ({
    key: `${keyPrefix}-${j}`,
    dur: dur.toFixed(2),
    delay: (-((j * dur) / cnt) - turn).toFixed(2),
    fail: fail > 0 && j < Math.max(1, Math.round(cnt * fail)),
    tone: algo === 'hash' ? idx % TONES : undefined,
  }));
}

type RouteMode = ViewPrefs['route'];

/** The routed path of a line, or null for a straight one. */
function routeOf(mode: RouteMode, a: Point, b: Point, ends: Ends): Route | null {
  if (mode === 'elbow') return elbowRoute(a, b, ends.toR, ends.fromR);
  if (mode === 'curve') return curveRoute(a, b, ends);
  return null;
}

function line(key: string, a: Point, b: Point, targetRadius: number, pk: PacketView[], retract = false, mode: RouteMode = 'straight', ends?: Ends): LineView {
  const s = segment(a, b);
  const lv: LineView = {
    key, x: s.x, y: s.y, len: +s.len.toFixed(1), ang: +s.ang.toFixed(2), arrowX: Math.max(0, s.len - targetRadius - 11),
    tailX: Math.min(Math.max(0, ends?.fromR ?? 0), Math.max(0, s.len - 4)), packets: retract ? [] : pk, retract,
  };
  const r = retract ? null : routeOf(mode, a, b, ends ?? { fromR: 0, toR: targetRadius + 2 });
  if (r) lv.path = { d: r.d, arrow: r.arrow, start: r.start };
  return lv;
}

/** Point a fraction t along a line, following its route when it has one. */
function along(a: Point, b: Point, t: number, mode: RouteMode, ends: Ends = { fromR: 0, toR: 0 }): Point {
  const r = routeOf(mode, a, b, ends);
  return r ? pointAlong(r.pts, t) : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Does a flow step from a straight to b? */
function flowHop(steps: string[], a: string, b: string): boolean {
  for (let i = 0; i < steps.length - 1; i++) if (steps[i] === a && steps[i + 1] === b) return true;
  return false;
}

const byIdOk = (doc: DesignDoc, id: string) => doc.nodes.some((n) => n.id === id);

/** % of a load balancer's traffic that goes down one of its connections (null with fewer than two). */
function lbEdgeShare(doc: DesignDoc, sim: SimResult, lbId: string, edgeId: string): number | null {
  const out = doc.edges.filter((x) => x.from === lbId && sim.byId.has(x.to));
  if (out.length < 2) return null;
  const total = out.reduce((s, x) => s + (sim.edgeRps[x.id] ?? 0), 0);
  return total > 0 ? Math.round(((sim.edgeRps[edgeId] ?? 0) / total) * 100) : 0;
}

/** Collapses doc + simulation + ui state into what the canvas draws. Pure. */
export function buildCanvasView(doc: DesignDoc, sim: SimResult, ui: CanvasUi): CanvasView {
  const { sel, flowPlay, recording } = ui;
  const flowShown = doc.flows.find((f) => f.id === (flowPlay?.id ?? recording));
  const playing = !!flowPlay && !!flowShown;
  const stepsOf = new Map<string, number[]>();
  flowShown?.steps.forEach((id, i) => stepsOf.set(id, [...(stepsOf.get(id) ?? []), i + 1]));

  // collapsed groups hide their members; connections and flows attach to the card instead
  const owners = collapsedOwners(doc);
  const groupById = new Map(doc.groups.map((g) => [g.id, g]));
  const ownerOf = (type: 'node' | 'note' | 'group', id: string) => owners.get(`${type}:${id}`);
  const positions = new Map<string, Point[]>();
  for (const n of doc.nodes) {
    const og = ownerOf('node', n.id);
    positions.set(n.id, og ? [cardCenter(groupById.get(og)!)] : instancePositions(n, sim));
  }

  /* ---------- selection set (single or many) ---------- */
  const multi = ui.multi ?? [];
  const picked = new Set(multi.map((p) => `${p.type}:${p.id}`));
  if (sel && sel.type !== 'edge') picked.add(`${sel.type}:${sel.id}`);
  const isPicked = (type: string, id: string) => picked.has(`${type}:${id}`);

  /* ---------- rewire drag ---------- */
  const rw = ui.rewire;
  const rwEdge = rw ? doc.edges.find((x) => x.id === rw.edgeId) : undefined;
  const dropOf = (id: string): 'ok' | 'bad' | null =>
    rw && rwEdge && rw.over === id ? (canRewire(doc, rw.edgeId, rw.end, id) ? 'ok' : 'bad') : null;

  /* ---------- readability: shared infra, focus ---------- */
  const view = ui.view ?? DEFAULT_VIEW;
  const hubs = view.edges === 'smart' ? findHubs(doc) : new Set<string>();
  // focus = what is selected (a node, several, or both ends of a connection); hover only lights up
  const selEdge = sel?.type === 'edge' ? doc.edges.find((x) => x.id === sel.id) : undefined;
  const focusIds = [...picked].filter((k) => k.startsWith('node:')).map((k) => k.slice(5));
  if (selEdge) focusIds.push(selEdge.from, selEdge.to);
  const focus = focusSet(doc, focusIds);
  // one selected component: light its whole journey (users → it → everything it calls), numbered
  const single = sel?.type === 'node' && !multi.length && !playing && !rw ? sel.id : null;
  const journey = single ? traceJourney(doc, sim, single) : null;
  const jp = journey && ui.journeyPlay?.focus === journey.focus ? ui.journeyPlay : null;
  /** step reached by the playback (null = whole journey shown at once) */
  const reached = jp ? jp.idx + 1 : null;
  if (journey) { focus.nodes = new Set(journey.nodeStep.keys()); focus.edges = new Set(journey.edgeStep.keys()); }
  const focused = focus.nodes.size > 0 && !playing && !rw;
  const hover = ui.hover && byIdOk(doc, ui.hover) ? focusSet(doc, [ui.hover]) : null;
  /** a line into a hub stays hidden unless something about it is in focus */
  const hiddenEdge = (e: { id: string; from: string; to: string }) => hubs.has(e.to)
    && !focus.edges.has(e.id) && !hover?.edges.has(e.id) && !(selEdge?.id === e.id) && rw?.edgeId !== e.id
    && !(flowShown && flowHop(flowShown.steps, e.from, e.to));
  const chipsOf = (id: string) => {
    const label = (x: string) => sim.byId.get(x)?.label ?? x;
    const hot = (x: string) => { const t = sim.byId.get(x); return !!t && (t.down || isOver(sim.load[x] ?? 0)); };
    const outs = doc.edges.filter((e) => e.from === id && hiddenEdge(e) && !ownerOf('node', e.to)).map((e) => e.to);
    const list = [...new Set(outs)].map((x) => ({ key: x, text: label(x), hot: hot(x) }));
    const shown = list.slice(0, 3);
    if (list.length > 3) shown.push({ key: '+more', text: `+${list.length - 3}`, hot: list.slice(3).some((c) => c.hot) });
    if (hubs.has(id)) {
      const callers = new Set(doc.edges.filter((e) => e.to === id).map((e) => e.from)).size;
      shown.unshift({ key: 'callers', text: `← ${callers} callers`, hot: false });
    }
    return shown;
  };

  /* ---------- nodes ---------- */
  const nodes: NodeView[] = doc.nodes.filter((n) => !ownerOf('node', n.id)).map((n) => {
    const v = buildNode(n, sim, ui, positions.get(n.id)!, stepsOf, playing);
    const js = journey?.nodeStep.get(n.id);
    return {
      ...v, drop: dropOf(n.id), selected: isPicked('node', n.id),
      dim: v.dim || (focused && !focus.nodes.has(n.id)) || (reached != null && (js == null || js > reached)),
      badge: js != null ? String(js) : v.badge,
      tcur: reached != null && js === reached,
      chips: chipsOf(n.id),
    };
  });

  /* ---------- edges ---------- */
  const edges: EdgeView[] = [];
  // connections into / out of a collapsed group merge into one line per neighbour
  const merged = new Map<string, { rps: number; count: number }>();
  const mergeKey = (e: { from: string; to: string }) => {
    const ga = ownerOf('node', e.from), gb = ownerOf('node', e.to);
    if (!ga && !gb) return null;
    if (ga && ga === gb) return 'internal';
    return `${ga ? 'g:' + ga : e.from}>${gb ? 'g:' + gb : e.to}`;
  };
  for (const e of doc.edges) {
    const k = mergeKey(e);
    if (!k || k === 'internal') continue;
    const m = merged.get(k) ?? { rps: 0, count: 0 };
    m.rps += sim.edgeRps[e.id] ?? 0; m.count++;
    merged.set(k, m);
  }
  const drawnMerged = new Set<string>();
  /** does a merged group line touch a focused node (through the collapsed group)? */
  const mergedTouches = (mk: string, ids: Set<string>) => doc.edges.some((x) => mergeKey(x) === mk && (ids.has(x.from) || ids.has(x.to)));
  const CARD_R = Math.min(GROUP_CARD.w, GROUP_CARD.h) / 2;

  // which lines get drawn (hub lines hidden, one line per merged group pair)
  const drawn: DesignEdge[] = [];
  for (const e of doc.edges) {
    if (!sim.byId.get(e.from) || !sim.byId.get(e.to)) continue;
    const mk = mergeKey(e);
    if (mk === 'internal' || (!mk && hiddenEdge(e))) continue;
    if (mk) { if (drawnMerged.has(mk)) continue; drawnMerged.add(mk); }
    drawn.push(e);
  }
  // each line gets its own port on both ends, ordered by where the other end sits (fewer crossings)
  const endKey = (id: string) => { const g = ownerOf('node', id); return g ? `g:${g}` : id; };
  const posOf = (id: string) => positions.get(id)![0];
  const ports = (side: 'from' | 'to') => {
    const other = side === 'from' ? 'to' : 'from';
    const bySide = new Map<string, DesignEdge[]>();
    for (const e of drawn) { const k = endKey(e[side]); bySide.set(k, [...(bySide.get(k) ?? []), e]); }
    const out = new Map<string, number>();
    for (const list of bySide.values()) {
      list.sort((x, y) => posOf(x[other]).y - posOf(y[other]).y || posOf(x[other]).x - posOf(y[other]).x);
      const offs = portOffsets(list.length);
      list.forEach((e, i) => out.set(e.id, offs[i]));
    }
    return out;
  };
  const outPort = ports('from'), inPort = ports('to');
  const hoverE = ui.hoverEdge && drawn.some((e) => e.id === ui.hoverEdge) ? ui.hoverEdge : null;

  for (const e of drawn) {
    const a = sim.byId.get(e.from)!, b = sim.byId.get(e.to)!;
    const mk = mergeKey(e);
    const intoCard = !!ownerOf('node', b.id);
    const A = positions.get(a.id)!, B = positions.get(b.id)!;
    const kb = KINDS[b.kind];
    const r = intoCard ? CARD_R : (Math.min(kb.w, kb.h) / 2 - 4) * nodeScale(b, sim);
    const agg = mk ? merged.get(mk)! : null;
    const rps = agg ? agg.rps : sim.edgeRps[e.id] ?? 0;
    const failR = failShare(b.down, !!sim.cacheBypass[b.id], sim.load[b.id] ?? 0);
    const fail = failR > 0;

    const pairs: [Point, Point, number][] = [];
    if (agg) pairs.push([A[0], B[0], 1]);
    else if (A.length > 1) A.forEach((p) => pairs.push([p, B[0], 1]));
    else if (isDbCluster(b)) {
      const L = dbLayout(b);
      L.primaries.forEach((p, s) => {
        if (e.op !== 'read' || L.shown.replicas === 0) pairs.push([A[0], p, 1]);
        if (e.op !== 'write') L.replicas[s].forEach((q) => pairs.push([A[0], q, DB_REPLICA_SCALE]));
      });
    } else if (B.length > 1 && (isBalancer(a) || a.kind === 'queue')) B.forEach((p) => pairs.push([A[0], p, 1]));
    else pairs.push([A[0], B[0], 1]);

    const draining = (node: DesignNode, list: Point[]) => list.length > 1 && !!ui.drain[node.id] && (sim.reps[node.id] ?? 0) <= list.length;
    const drainTo = draining(b, B) && pairs.length === B.length;
    const drainFrom = draining(a, A) && pairs.length === A.length;
    const each = rps / pairs.length;
    const perRep = !agg && a.kind === 'lb' && pairs.length === B.length ? sim.edgeRepRps[e.id] : undefined;
    // load balancer → backend lines show the algorithm (share, turns, weights, connections, stickiness)
    const lbAlgo = !agg && a.kind === 'lb' ? lbConfig(a).algo : null;
    const lbList = lbAlgo ? (sim.lbBackends[a.id] ?? []).filter((x) => !x.down) : [];
    const lbOut = lbAlgo ? doc.edges.filter((x) => x.from === a.id).reduce((t, x) => t + (sim.edgeRepRps[x.id] ?? []).reduce((u, v) => u + v, 0), 0) : 0;
    const lbDur = Math.max(0.9, Math.min(2.6, 2.8 - Math.log10(lbOut + 1) * 0.38));
    // clients entering an IP-hash balancer get colours too, so the stickiness is visible end to end
    const intoHash = !agg && b.kind === 'lb' && lbConfig(b).algo === 'hash';
    const isSel = sel?.type === 'edge' && sel.id === e.id;
    // with several items selected, connections between them light up too (they get copied with them)
    const inMulti = multi.length > 1 && isPicked('node', e.from) && isPicked('node', e.to);
    const ka = KINDS[a.kind];
    const rA = ownerOf('node', a.id) ? CARD_R : (Math.min(ka.w, ka.h) / 2 - 4) * nodeScale(a, sim);
    const seg0 = segment(A[0], B[0]);
    const ux = seg0.len > 0 ? (B[0].x - A[0].x) / seg0.len : 0, uy = seg0.len > 0 ? (B[0].y - A[0].y) / seg0.len : 0;
    const routed = view.route === 'curve' ? curveRoute(A[0], B[0], { fromR: rA, toR: r + 2, fromPort: outPort.get(e.id) ?? 0, toPort: inPort.get(e.id) ?? 0 }) : null;
    const handles = isSel && !agg && !ui.readOnly && !playing && !rw
      ? routed
        ? { from: { x: Math.round(routed.pts[0].x), y: Math.round(routed.pts[0].y) }, to: { x: Math.round(routed.arrow.x), y: Math.round(routed.arrow.y) } }
        : { from: { x: Math.round(A[0].x + ux * rA), y: Math.round(A[0].y + uy * rA) }, to: { x: Math.round(B[0].x - ux * (r + 2)), y: Math.round(B[0].y - uy * (r + 2)) } }
      : null;
    const lbShare = a.kind === 'lb' ? lbEdgeShare(doc, sim, a.id, e.id) : null;
    const mode = view.route;
    const endsOf = (scale: number): Ends => ({ fromR: rA, toR: r * scale + 2, fromPort: outPort.get(e.id) ?? 0, toPort: inPort.get(e.id) ?? 0 });
    const mid = along(A[0], B[0], 0.5, mode, endsOf(1));
    const tone: EdgeView['tone'] = fail ? 'fail' : (sim.load[b.id] ?? 0) >= 0.7 ? 'busy' : 'ok';
    const isHover = hoverE === e.id;
    const toLabel = agg && agg.count > 1 ? `${agg.count} connections` : `${a.label} → ${b.label}`;
    const tip = isHover
      ? [toLabel, `${fmtCompact(rps)} rps`, agg ? '' : `${Math.round(sim.nodeLatency[b.id] ?? 0)} ms`, tone === 'fail' ? 'failing' : tone === 'busy' ? 'busy' : ''].filter(Boolean).join(' · ')
      : null;

    edges.push({
      id: e.id,
      lines: pairs.map(([p, q, scale], i) => {
        const rpsI = perRep ? perRep[i] ?? 0 : each;
        const failRI = perRep ? failShare(b.down, !!sim.cacheBypass[b.id], sim.repLoad[b.id]?.[i] ?? 0) : failR;
        const failI = failRI > 0;
        const key = `${e.id}-${i}`;
        const retract = i === pairs.length - 1 && (drainTo || drainFrom);
        if (lbAlgo) {
          // one line per replica when fanned, otherwise one line for the whole target
          const mine = perRep ? lbList.filter((x) => x.edgeId === e.id && x.replica === i) : lbList.filter((x) => x.edgeId === e.id);
          const share = mine.reduce((t, x) => t + x.share, 0);
          const lineRps = mine.reduce((t, x) => t + x.rps, 0);
          const idx = Math.max(0, lbList.findIndex((x) => x === mine[0]));
          const pk = ui.running ? lbPackets(lineRps, share, idx, lbList.length, lbAlgo, lbDur, failRI, key) : [];
          const lv = line(key, p, q, r * scale, pk, retract, mode, endsOf(scale));
          if (lbList.length > 1 && lineRps >= MIN_VISIBLE_RPS) {
            const pct = `${Math.round(share * 100)}%`;
            const lat = (sim.nodeLatency[b.id] ?? KINDS[b.kind].lat) / 1000;
            const text = lbAlgo === 'rr' ? `1 in ${lbList.length} · ${pct}`
              : lbAlgo === 'wrr' ? `w${e.weight || 1} · ${pct}`
              : lbAlgo === 'lc' ? `${fmtCompact(lineRps * lat)} conns · ${pct}`
              : `${pct} of users`;
            const at = along(p, q, 0.82, mode, endsOf(scale));
            lv.tag = { text, x: Math.round(at.x), y: Math.round(at.y), hot: failI && !b.down };
          }
          return lv;
        }
        let pk = ui.running && !sim.breakerOpen[e.id] ? packets(rpsI, e.mode === 'async', failRI, key) : [];
        if (intoHash) pk = pk.map((x, j) => ({ ...x, tone: j % TONES }));
        const lv = line(key, p, q, r * scale, pk, retract, mode, endsOf(scale));
        // what this connection is doing, when it matters: breaker open > retry storm > fan-out
        const amp = sim.retryAmp[e.id] ?? 1;
        const tagText = i > 0 ? null : sim.breakerOpen[e.id] ? 'breaker open' : amp > 1.05 ? `retries ×${amp.toFixed(1)}` : (e.calls ?? 0) > 1 ? `${e.calls}× per request` : null;
        const at = along(p, q, 0.68, mode, endsOf(scale));
        if (tagText) lv.tag = { text: tagText, x: Math.round(at.x), y: Math.round(at.y), hot: !!sim.breakerOpen[e.id] || amp > 1.05 };
        return lv;
      }),
      async: e.mode === 'async',
      selected: isSel || inMulti,
      dim: playing || rw?.edgeId === e.id || (!!hoverE && !isHover) || (!hoverE && focused && !focus.edges.has(e.id) && !(mk && mergedTouches(mk, focus.nodes)))
        || (reached != null && (journey!.edgeStep.get(e.id) ?? Infinity) > reached),
      tcur: reached != null && journey!.edgeStep.get(e.id) === reached,
      hl: isHover || !!hover?.edges.has(e.id) || (focused && focus.edges.has(e.id)),
      read: e.op === 'read',
      weight: agg ? Math.min(4, 1 + Math.log2(agg.count)) : 1,
      tone,
      tip,
      label: agg && agg.count > 1
        ? `${agg.count} connections`
        : (e.route ? e.route + ' · ' : '') + e.proto + (e.mode === 'async' ? ' · async' : '') + (e.op !== 'both' ? ' · ' + e.op : '') + (lbShare != null ? ` · ${lbShare}%` : ''),
      showLabel: !ui.isLesson || isSel,
      labelX: Math.round(mid.x),
      labelY: Math.round(mid.y),
      handles,
      head: e.head ?? 'triangle',
      tail: e.tail ?? 'none',
    });
  }

  /* ---------- rewire ghost ---------- */
  let rewire: RewireView | null = null;
  if (rw && rwEdge) {
    const fixed = positions.get(rw.end === 'to' ? rwEdge.from : rwEdge.to)?.[0];
    if (fixed) {
      const p = { x: rw.x, y: rw.y };
      const s = rw.end === 'to' ? segment(fixed, p) : segment(p, fixed);
      rewire = {
        x: s.x, y: s.y, len: +s.len.toFixed(1), ang: +s.ang.toFixed(2), dotX: Math.round(p.x), dotY: Math.round(p.y),
        valid: !rw.over || canRewire(doc, rw.edgeId, rw.end, rw.over),
      };
    }
  }

  /* ---------- db replication ---------- */
  const replication: ReplicationLineView[] = [];
  for (const n of doc.nodes) {
    if (!isDbCluster(n) || ownerOf('node', n.id)) continue;
    const L = dbLayout(n), D = dbConfig(n), k = KINDS[n.kind];
    const live = ui.running && !n.down && (sim.inflow[n.id] ?? 0) > 0;
    const dur = D.sync ? 0.7 : 1.8;
    L.primaries.forEach((p, s) => L.replicas[s].forEach((q, j) => {
      const key = `${n.id}-r${s}-${j}`;
      const pk: PacketView[] = live ? [0, 1].map((i) => ({ key: `${key}-${i}`, dur: dur.toFixed(2), delay: (-(i * dur) / 2).toFixed(2), fail: false })) : [];
      replication.push({ ...line(key, p, q, (Math.min(k.w, k.h) / 2 - 4) * DB_REPLICA_SCALE, pk), sync: D.sync });
    }));
  }

  for (const n of doc.nodes) {
    if (!isRingDb(n) || ownerOf('node', n.id)) continue;
    const pts = ringLayout(n), k = KINDS[n.kind], rr = (Math.min(k.w, k.h) / 2 - 4) * RING_NODE_SCALE;
    const live = ui.running && !n.down;
    const pairs: [number, number][] = pts.map((_, i) => [i, (i + 1) % pts.length]);
    if (pts.length >= 6) pts.forEach((_, i) => { if (i % 2 === 0) pairs.push([i, (i + 2) % pts.length]); });
    pairs.forEach(([a, b], j) => {
      const key = `${n.id}-g${j}`;
      const pk: PacketView[] = live ? [{ key: `${key}-0`, dur: '3.20', delay: (-(j * 0.7) % 3.2).toFixed(2), fail: false }] : [];
      replication.push({ ...line(key, pts[a], pts[b], rr, pk), sync: false, gossip: true });
    });
  }

  /* ---------- flow overlay ---------- */
  const flow: FlowSegmentView[] = [];
  if (flowShown) {
    for (let i = 0; i < flowShown.steps.length - 1; i++) {
      const a = positions.get(flowShown.steps[i])?.[0], b = positions.get(flowShown.steps[i + 1])?.[0];
      if (!a || !b) continue;
      const idx = flowPlay?.idx ?? -1;
      const state = !flowPlay ? 'rec' : i < idx ? 'past' : i === idx ? 'cur' : 'next';
      const pts = view.route === 'elbow' ? elbowRoute(a, b, 0).pts : view.route === 'curve' ? curveRoute(a, b, { fromR: 0, toR: 0 }).pts : [a, b];
      for (let j = 0; j < pts.length - 1; j++) {
        if (Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].y - pts[j].y) < 0.5) continue;
        const s = segment(pts[j], pts[j + 1]);
        flow.push({
          key: `fs-${i}-${j}`, x: s.x, y: s.y, len: +s.len.toFixed(1), ang: +s.ang.toFixed(2), state,
          token: !!flowPlay && i === idx && j === Math.floor((pts.length - 1) / 2),
        });
      }
    }
  }

  const groups: GroupView[] = doc.groups.filter((g) => !ownerOf('group', g.id)).map((g) => {
    let summary: GroupSummaryView | null = null;
    if (g.collapsed) {
      const m = groupMembers(doc, g);
      const inside = new Set(m.nodes);
      const ns = doc.nodes.filter((n) => inside.has(n.id));
      const hot = ns.filter((n) => !n.down && isOver(sim.load[n.id] ?? 0));
      const down = ns.filter((n) => n.down);
      const busiest = ns.filter((n) => n.kind !== 'users' && !n.down).sort((x, y) => (sim.load[y.id] ?? 0) - (sim.load[x.id] ?? 0))[0];
      const inRps = doc.edges.filter((e) => inside.has(e.to) && !inside.has(e.from)).reduce((t, e) => t + (sim.edgeRps[e.id] ?? 0), 0);
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
      summary = {
        parts: [plural(ns.length, 'component'), m.notes.length ? plural(m.notes.length, 'note') : '', m.groups.length ? plural(m.groups.length, 'group') : ''].filter(Boolean).join(' · '),
        status: hot.length
          ? `${hot.length} overloaded · ${hot[0].label} ${Math.round((sim.load[hot[0].id] ?? 0) * 100)}%`
          : down.length ? `${down.length} offline · ${down[0].label}`
          : busiest ? `healthy · busiest ${busiest.label} ${Math.round((sim.load[busiest.id] ?? 0) * 100)}%` : 'empty',
        bad: hot.length > 0 || down.length > 0,
        traffic: inRps > 0 ? `${fmtCompact(inRps)} rps in` : '',
      };
    }
    return {
      id: g.id, x: g.collapsed ? cardLeft(g) : g.x, y: g.y,
      w: g.collapsed ? GROUP_CARD.w : g.w, h: g.collapsed ? GROUP_CARD.h : g.h,
      label: g.label,
      border: GROUP_COLORS[g.color]?.border ?? GROUP_COLORS.blue.border,
      bg: GROUP_COLORS[g.color]?.bg ?? GROUP_COLORS.blue.bg,
      selected: isPicked('group', g.id),
      collapsed: !!g.collapsed,
      summary,
    };
  });
  const notes: NoteView[] = doc.notes.filter((t) => !ownerOf('note', t.id)).map((t) => {
    const selected = isPicked('note', t.id);
    return { ...t, selected, open: view.notes === 'open' || selected || !t.text.trim() };
  });

  const mq = ui.marquee;
  const marquee = mq ? { x: Math.min(mq.x1, mq.x2), y: Math.min(mq.y1, mq.y2), w: Math.abs(mq.x2 - mq.x1), h: Math.abs(mq.y2 - mq.y1) } : null;

  const journeyView: JourneyView | null = journey ? {
    focus: journey.focus,
    label: sim.byId.get(journey.focus)?.label ?? journey.focus,
    steps: journey.steps,
    idx: jp ? jp.idx : null,
    playing: !!jp?.playing,
    caption: jp ? journey.captions[jp.idx] ?? '' : `${journey.steps} step${journey.steps === 1 ? '' : 's'} from the users to everything it calls`,
  } : null;

  return { journey: journeyView, nodes, edges, replication, flow, groups, notes, rewire, marquee };
}

function buildNode(
  n: DesignNode, sim: SimResult, ui: CanvasUi, pos: Point[], stepsOf: Map<string, number[]>, playing: boolean,
): NodeView {
  const k = KINDS[n.kind];
  const ld = sim.load[n.id] ?? 0;
  const lp = loadPill(ld, n.down);
  const colors: Colors = n.down ? DOWN_COLORS : lp.hot ? HOT_COLORS : k.colors;
  const sizeIdx = sim.sizeIdx[n.id] ?? n.size;
  const sz = SIZES[sizeIdx];
  const reps = sim.reps[n.id] ?? 1;
  const fanned = isFanned(n, sim);
  const scale = nodeScale(n, sim);
  const p0 = pos[0];
  const isUsers = n.kind === 'users';

  const spec = k.perCpu ? `${sz.cpu} vCPU · ${sz.ram} GB` : '';
  const auto = isHorizontalAuto(n);
  const repTxt = sim.needsLB[n.id] ? '' : isVerticalAuto(n) ? 'auto-size' : auto ? `auto ×${reps}${fanned ? ` (${n.autoscale.min}–${n.autoscale.max})` : ''}` : reps > 1 ? `×${reps}` : '';
  const algoTxt = n.kind === 'lb' ? LB_ALGOS.find((x) => x.key === lbConfig(n).algo)?.name ?? '' : '';
  let below = isUsers ? `${fmtInt(sim.users)} users` : k.shape === 'cube' ? [spec, repTxt].filter(Boolean).join(' · ') : [n.label, algoTxt, spec, repTxt].filter(Boolean).join(' · ');
  if (fanned && reps > pos.length) below += ` · +${reps - pos.length} more`;

  let warn: string | null = null;
  if (n.down) warn = n.kind !== 'cache' ? 'node offline' : sim.cacheBypass[n.id] ? 'offline · reads fall through to DB' : 'offline · reads fail (no DB behind it)';
  else if (n.kind === 'cache' && sim.cacheRefill[n.id] === false) warn = (sim.cacheHit[n.id] ?? 0) > 0 ? `DB offline · keys expiring · ${Math.round((sim.cacheHit[n.id] ?? 0) * 100)}% hits` : 'DB offline · cache empty';
  else if (n.kind === 'cache' && (sim.cacheHit[n.id] ?? CACHE_HIT) < CACHE_HIT - 0.005) warn = `warming up · ${Math.round((sim.cacheHit[n.id] ?? 0) * 100)}% hits`;
  else if (n.kind === 'db' && sim.dbConns[n.id] && sim.dbConns[n.id].need > sim.dbConns[n.id].limit) warn = `too many connections · ${fmtInt(sim.dbConns[n.id].need)}/${fmtInt(sim.dbConns[n.id].limit)}`;
  else if (sim.needsLB[n.id]) warn = 'needs a load balancer';
  else if (lp.hot) warn = n.kind === 'ext' ? 'rate limited' : auto && reps >= n.autoscale.max ? 'hit max replicas' : k.perCpu && sizeIdx === 4 && reps === 1 ? 'largest machine you can buy' : 'over capacity';

  const repPill = (i: number) => (sim.repLoad[n.id]?.[i] != null ? loadPill(sim.repLoad[n.id][i], n.down) : lp);
  const repColors = (pill: LoadPillView): Colors => (n.down ? DOWN_COLORS : pill.hot ? HOT_COLORS : k.colors);
  let load: LoadPillView | null = isUsers ? null : fanned ? repPill(0) : lp;
  let bands = false;
  const extras: InstanceView[] = [];
  const draining = !!ui.drain[n.id] && fanned && reps <= pos.length;

  if (fanned) {
    pos.slice(1).forEach((p, j) => {
      const isLast = j === pos.length - 2;
      const pill = repPill(j + 1);
      extras.push({
        key: `${n.id}-x${j}`, dx: p.x - p0.x, dy: p.y - p0.y, shape: k.shape, w: k.w, h: k.h, scale, colors: repColors(pill), icon: ICONS[n.kind],
        label: `${n.label} ${LETTERS[j + 1]}`, bands: false,
        load: draining && isLast ? { ...pill, pct: 'draining' } : pill,
        below: isLast ? { text: below, info: false } : null,
        draining: draining && isLast,
      });
    });
  }

  if (n.kind === 'db' && isRingDb(n)) {
    // Leaderless ring: the database in the middle is the coordinator the callers talk to; its
    // nodes sit around it, the first `down` of them failed.
    const cfg = ringConfig(n);
    const r = sim.ring?.[n.id] ?? { ...cfg, ...ringNodeLoads(cfg, 1, 0.9, 0), unavailable: 0, stale: staleReadShare(cfg.rf, cfg.k, cfg.kw) };
    const pts = ringLayout(n), node = loadPill(sim.dbLoad[n.id]?.w ?? ld, n.down);
    const live = r.nodes - r.down, skewed = r.hot > 0 && r.hotNodes < live;
    const hotPill = loadPill(r.hotLoad, n.down), coldPill = loadPill(r.coldLoad, n.down);
    load = node;
    const CL = r.cl === r.wcl ? r.cl.toUpperCase() : `R ${r.cl.toUpperCase()} / W ${r.wcl.toUpperCase()}`;
    below = `${n.label} · ring of ${r.nodes} · RF ${r.rf} · ${CL}`;
    pts.forEach((p, i) => {
      // failed nodes first, then the hot key's replicas (next to each other, like SimpleStrategy)
      const dead = n.down || i < r.down;
      const pill = dead ? loadPill(0, true) : skewed ? (i < r.down + r.hotNodes ? hotPill : coldPill) : node;
      extras.push({
        key: `${n.id}-n${i}`, dx: p.x - p0.x, dy: p.y - p0.y, shape: 'db', w: k.w, h: k.h, scale: RING_NODE_SCALE,
        colors: dead ? DOWN_COLORS : repColors(pill), icon: ICONS.db, label: '', bands: false, load: pill,
        below: i === 0 && r.nodes > RING_MAX_SHOWN ? { text: `+${r.nodes - RING_MAX_SHOWN} more nodes`, info: true } : null, draining: false,
      });
    });
    const pct = (v: number) => `${Math.max(1, Math.round(v * 100))}%`;
    const mb = effectivePartitionMb(r);
    if (n.down) { /* the offline warning stays */ } else if (r.down > 0) {
      warn = r.unavailable > 0
        ? `${r.down} of ${r.nodes} nodes down · ${pct(r.unavailable)} of requests below ${CL}`
        : `${r.down} of ${r.nodes} nodes down · still ${CL}`;
    } else if (skewed && r.hotLoad > r.coldLoad * 1.5) {
      warn = `hot partition · ${r.hotNodes} of ${live} nodes at ${pct(r.hotLoad)}, the rest ${pct(r.coldLoad)}`;
    } else if (mb > WIDE_PARTITION_MB) {
      warn = `wide partitions · ${Math.round(mb)} MB (keep under ${WIDE_PARTITION_MB} MB)`;
    } else if (r.stale > 0) {
      warn = `R + W ≤ RF · up to ${pct(r.stale)} of fresh reads stale`;
    }
  } else if (n.kind === 'db') {
    const D = dbConfig(n);
    bands = D.partition !== 'none';
    const partTxt = bands ? `${D.parts} partitions by ${D.partKey}` : '';
    if (isDbCluster(n)) {
      const L = dbLayout(n), dl = sim.dbLoad[n.id] ?? { w: 0, r: 0 };
      const w = loadPill(dl.w, n.down), r = loadPill(dl.r, n.down);
      const shardTxt = (s: number) => (D.shards > 1
        ? `Shard ${s + 1} · ${D.strategy === 'hash' ? `hash(${D.shardKey}) % ${D.shards} = ${s}` : D.strategy === 'geo' ? GEO[s % 4] : `${D.shardKey} range ${s + 1}/${D.shards}`}`
        : `${n.label} · primary`);
      const more = (D.shards > L.shown.shards ? ` · +${D.shards - L.shown.shards} shards` : '') + (D.replicas > L.shown.replicas ? ` · +${D.replicas - L.shown.replicas} replicas` : '');
      load = w;
      below = shardTxt(0) + (partTxt ? ` · ${partTxt}` : '') + more;
      L.primaries.slice(1).forEach((p, i) => extras.push({
        key: `${n.id}-s${i}`, dx: p.x - p0.x, dy: 0, shape: 'db', w: k.w, h: k.h, scale: 1, colors, icon: ICONS.db,
        label: '', bands, load: w, below: { text: shardTxt(i + 1), info: false }, draining: false,
      }));
      L.replicas.forEach((row, s) => row.forEach((q, j) => extras.push({
        key: `${n.id}-r${s}-${j}`, dx: q.x - p0.x, dy: q.y - p0.y, shape: 'db', w: k.w, h: k.h, scale: DB_REPLICA_SCALE,
        colors: n.down ? colors : REPLICA_COLORS, icon: ICONS.db, label: '', bands, load: r,
        below: j === 0 ? { text: `${D.replicas > 1 ? `read replicas ×${D.replicas}` : 'read replica'} · ${D.sync ? 'sync' : 'async'}`, info: true } : null,
        draining: false,
      })));
    } else if (partTxt) below += ` · ${partTxt}`;
  }

  let queue: QueueVisual | null = null;
  if (n.kind === 'queue') {
    const q = sim.queue[n.id];
    const depth = q?.depth ?? 0, growth = q?.growth ?? 0;
    const fill = depth > 0.5 ? Math.log10(1 + depth) / Math.log10(1 + QUEUE_MAX) : 0;
    const state: QueueVisual['state'] = n.down ? 'down' : q?.full ? 'full' : growth > 0.5 ? 'growing' : growth < -0.5 ? 'draining' : depth > 0.5 ? 'steady' : 'empty';
    const color = { full: '#e5484d', growing: '#e09a2c', draining: '#3f9b6b', steady: '#4f86c9', empty: '#4f86c9', down: '#9a9a95' }[state];
    load = { pct: n.down ? 'offline' : `${fmtCompact(depth)} msgs`, width: Math.round(fill * 100), color, hot: state === 'full' };
    const trend = state === 'growing' ? `+${fmtCompact(growth)}/s`
      : state === 'draining' ? `empty in ~${Math.max(1, Math.ceil(depth / -growth))}s`
      : state === 'full' ? 'full' : (q?.inRate ?? 0) > 0 ? `${fmtCompact(q!.inRate)}/s flowing` : 'idle';
    const subs = q?.mode === 'pubsub' ? `pub/sub → ${q.subscribers.length}` : '';
    below = [n.label, subs, trend].filter(Boolean).join(' · ');
    if (!n.down && q?.full) warn = 'queue full · rejecting messages';
    else if (!n.down && q && q.inRate > 0 && q.consumers === 0) warn = 'no consumer · messages pile up';
    const rate = Math.max(q?.inRate ?? 0, q?.outRate ?? 0);
    queue = {
      filled: depth > 0.5 ? Math.max(1, Math.ceil(fill * 4)) : 0,
      flowing: ui.running && !n.down && rate > 0,
      dur: Math.max(0.8, Math.min(2.6, 2.8 - Math.log10(rate + 1) * 0.4)).toFixed(2),
      state,
    };
  }

  const steps = stepsOf.get(n.id);
  return {
    id: n.id, kind: n.kind,
    left: p0.x - k.w / 2, top: p0.y - k.h / 2, w: k.w, h: k.h,
    shape: k.shape, scale, colors: fanned && load ? repColors(load) : colors, icon: ICONS[n.kind],
    label: fanned ? `${n.label} A` : n.label,
    name: n.label,
    dashed: n.kind === 'ext',
    bands,
    ghostStack: !k.canAuto && k.shape === 'cube' ? (reps >= 3 ? 2 : reps >= 2 ? 1 : 0) : 0,
    people: isUsers ? crowd(sim.users) : [],
    load,
    below: below && !fanned ? { text: below, info: false } : null,
    warn,
    badge: steps ? steps.join(',') : null,
    selected: ui.sel?.type === 'node' && ui.sel.id === n.id,
    pending: ui.pending === n.id,
    hot: (fanned && load ? load.hot : lp.hot) && ui.running,
    dim: playing && !steps,
    crosshair: ui.tool === 'connect' || !!ui.recording,
    extras,
    queue,
    chips: [],
  };
}
