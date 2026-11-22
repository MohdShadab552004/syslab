import type { DesignDoc, NodeKind } from '@syslab/types';
import type { Point } from '@syslab/sim';

/**
 * Helpers that keep big diagrams readable: shared infrastructure ("hubs") whose lines are hidden
 * behind chips, the focus set around a selection, and right-angle (elbow) routing of lines.
 * All pure, so they are easy to test and cheap to run on every render.
 */

/** How the canvas draws a design. Stored per browser, not in the design. */
export interface ViewPrefs {
  /** smart: lines into shared infra (Redis, Mongo, email…) hide behind chips until focused */
  edges: 'smart' | 'all';
  /** curve: separate smooth lines with their own ports; elbow: right-angle lines; straight: direct lines */
  route: 'curve' | 'elbow' | 'straight';
  /** icons: sticky notes are small icons that open when selected */
  notes: 'icons' | 'open';
}

export const DEFAULT_VIEW: ViewPrefs = { edges: 'smart', route: 'curve', notes: 'icons' };
/** v2: curves became the default, so older saved choices start fresh */
const VIEW_KEY = 'syslab.view.v2';

export function loadViewPrefs(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ViewPrefs {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const v = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      edges: v.edges === 'all' ? 'all' : 'smart',
      route: v.route === 'straight' || v.route === 'elbow' ? v.route : 'curve',
      notes: v.notes === 'open' ? 'open' : 'icons',
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveViewPrefs(v: ViewPrefs, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* private mode: keep it in memory */ }
}

/** Kinds that many services share; their incoming lines are the main source of clutter. */
const HUB_KINDS = new Set<NodeKind>(['cache', 'db', 'store', 'queue', 'ext']);
/** A shared node with at least this many distinct callers becomes a hub. */
export const HUB_MIN_CALLERS = 4;

/** Shared infrastructure: data / queue / external nodes called by many different components. */
export function findHubs(doc: Pick<DesignDoc, 'nodes' | 'edges'>, minCallers = HUB_MIN_CALLERS): Set<string> {
  const kind = new Map(doc.nodes.map((n) => [n.id, n.kind]));
  const callers = new Map<string, Set<string>>();
  for (const e of doc.edges) {
    if (!kind.has(e.from) || !HUB_KINDS.has(kind.get(e.to)!)) continue;
    const s = callers.get(e.to) ?? new Set<string>();
    s.add(e.from);
    callers.set(e.to, s);
  }
  return new Set([...callers].filter(([, s]) => s.size >= minCallers).map(([id]) => id));
}

/**
 * The neighbourhood of the focused nodes: the nodes themselves, everything directly connected,
 * and the connecting edges. Used to dim everything else.
 */
export function focusSet(doc: Pick<DesignDoc, 'edges'>, ids: Iterable<string>): { nodes: Set<string>; edges: Set<string> } {
  const focus = new Set(ids);
  const nodes = new Set(focus), edges = new Set<string>();
  if (!focus.size) return { nodes, edges };
  for (const e of doc.edges) {
    if (focus.has(e.from) || focus.has(e.to)) {
      edges.add(e.id);
      nodes.add(e.from);
      nodes.add(e.to);
    }
  }
  return { nodes, edges };
}

export interface Route {
  /** corner points from start to end */
  pts: Point[];
  /** SVG path data */
  d: string;
  /** total length */
  len: number;
  /** arrowhead tip and direction (degrees) */
  arrow: { x: number; y: number; ang: number };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Right-angle route from a to b: horizontal, vertical, horizontal (or the vertical version when
 * the target is mostly above / below). Lines from one source to many targets share the first leg
 * and the vertical trunk, so fanned lines bundle naturally. The end is pulled back by `targetR`
 * so the arrowhead sits on the target's edge instead of under it.
 */
export function elbowRoute(a: Point, b: Point, targetR: number): Route {
  const dx = b.x - a.x, dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.6;
  let pts: Point[];
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) pts = [a, b];
  else if (horizontal) { const mx = a.x + dx / 2; pts = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]; }
  else { const my = a.y + dy / 2; pts = [a, { x: a.x, y: my }, { x: b.x, y: my }, b]; }

  // pull the last leg back so it stops at the target's rim
  const p = pts[pts.length - 2], q = pts[pts.length - 1];
  const legLen = Math.hypot(q.x - p.x, q.y - p.y);
  const cut = Math.min(Math.max(0, targetR), Math.max(0, legLen - 4));
  const ux = legLen > 0 ? (q.x - p.x) / legLen : 0, uy = legLen > 0 ? (q.y - p.y) / legLen : 0;
  const end = { x: q.x - ux * cut, y: q.y - uy * cut };
  pts = [...pts.slice(0, -1), end].map((v) => ({ x: r1(v.x), y: r1(v.y) }));

  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${v.x} ${v.y}`).join(' ');
  return { pts, d, len: r1(len), arrow: { x: end.x, y: end.y, ang: r1((Math.atan2(uy, ux) * 180) / Math.PI) } };
}

/** How a line meets its two nodes: their radii and the port offsets on each side. */
export interface Ends { fromR: number; toR: number; fromPort?: number; toPort?: number }

const CURVE_SAMPLES = 16;

/**
 * A smooth curve that leaves the source on the side facing the target and enters the target on
 * the side facing the source, each at its own port offset, so lines from one node fan out
 * instead of sharing a trunk. Mostly vertical neighbours bend vertically instead.
 */
export function curveRoute(a: Point, b: Point, ends: Ends): Route {
  const fp = ends.fromPort ?? 0, tp = ends.toPort ?? 0;
  const vertical = Math.abs(b.x - a.x) < Math.max(ends.fromR, ends.toR) * 1.2 && Math.abs(b.y - a.y) > ends.fromR + ends.toR;
  let s: Point, e: Point, c1: Point, c2: Point;
  if (vertical) {
    const dir = b.y >= a.y ? 1 : -1;
    s = { x: a.x + fp, y: a.y + dir * ends.fromR };
    e = { x: b.x + tp, y: b.y - dir * ends.toR };
    const k = Math.max(30, Math.abs(e.y - s.y) * 0.5);
    c1 = { x: s.x, y: s.y + dir * k };
    c2 = { x: e.x, y: e.y - dir * k };
  } else {
    const dir = b.x >= a.x ? 1 : -1;
    s = { x: a.x + dir * ends.fromR, y: a.y + fp };
    e = { x: b.x - dir * ends.toR, y: b.y + tp };
    const k = Math.max(40, Math.abs(e.x - s.x) * 0.5);
    c1 = { x: s.x + dir * k, y: s.y };
    c2 = { x: e.x - dir * k, y: e.y };
  }
  const at = (t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * u * s.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * e.x,
      y: u * u * u * s.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * e.y,
    };
  };
  const pts = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => at(i / CURVE_SAMPLES)).map((v) => ({ x: r1(v.x), y: r1(v.y) }));
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  // the arrow points along the curve's last tangent (end minus second control point)
  const ang = (Math.atan2(e.y - c2.y, e.x - c2.x) * 180) / Math.PI;
  const f = (v: Point) => `${r1(v.x)} ${r1(v.y)}`;
  return { pts, d: `M${f(s)} C${f(c1)} ${f(c2)} ${f(e)}`, len: r1(len), arrow: { x: r1(e.x), y: r1(e.y), ang: r1(ang) } };
}

/** Port offsets: lines leaving (or entering) one node spread out, ordered by where they go. */
export function portOffsets(count: number, gap = 9, span = 56): number[] {
  const g = count > 1 ? Math.min(gap, span / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => r1((i - (count - 1) / 2) * g));
}

/** The point a fraction `t` (0..1) of the way along a polyline. */
export function pointAlong(pts: Point[], t: number): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  const segs = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  let left = Math.max(0, Math.min(1, t)) * segs.reduce((s, l) => s + l, 0);
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const f = segs[i] > 0 ? Math.min(1, left / segs[i]) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    }
    left -= segs[i];
  }
  return pts[pts.length - 1];
}
