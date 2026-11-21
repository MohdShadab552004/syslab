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
  /** elbow: right-angle lines; straight: direct lines */
  route: 'elbow' | 'straight';
  /** icons: sticky notes are small icons that open when selected */
  notes: 'icons' | 'open';
}

export const DEFAULT_VIEW: ViewPrefs = { edges: 'smart', route: 'elbow', notes: 'icons' };
const VIEW_KEY = 'syslab.view';

export function loadViewPrefs(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ViewPrefs {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const v = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      edges: v.edges === 'all' ? 'all' : 'smart',
      route: v.route === 'straight' ? 'straight' : 'elbow',
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
