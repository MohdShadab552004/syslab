import type { DesignEdge, DesignNode } from '@syslab/types';
import { KINDS, dbConfig } from '@syslab/sim';

/** Where a node ended up, plus how much room it takes around its anchor (for boxes). */
export interface Placed { x: number; y: number; w: number; h: number; left: number; right: number; top: number; bottom: number }
export interface Box { x: number; y: number; w: number; h: number }

const COL_GAP = 170;      // horizontal room between columns, for edge labels
const ROW_GAP = 46;       // vertical room between nodes in one column
const BAND_GAP = 120;     // vertical room between group bands (group label + padding)
const PAD = 40;           // group box padding
const ORIGIN = { x: 150, y: 140 };

/**
 * How far a node's drawing reaches from its anchor (x, y), including replicas fanned out to the
 * right, database shards and read replicas, and the load / name pills above and below it.
 * Mirrors the editor's instancePositions / dbLayout so laid-out nodes never overlap.
 */
function extents(n: DesignNode) {
  const k = KINDS[n.kind];
  let left = k.w / 2, right = k.w / 2, top = k.h / 2, bottom = k.h / 2;
  const scaled = k.canAuto && (n.autoscale.on && n.autoscale.mode !== 'v' ? n.autoscale.max > 1 : n.replicas > 1);
  if (scaled) {
    const expected = n.autoscale.on && n.autoscale.mode !== 'v' ? Math.max(n.autoscale.min, Math.min(n.autoscale.max, 4)) : n.replicas;
    const visible = Math.min(8, expected), rows = Math.min(visible, 4), cols = Math.ceil(visible / 4);
    right += (rows - 1) * 62 + (cols - 1) * 165;
    top += (rows - 1) * 55;
    bottom += (rows - 1) * 55;
  }
  if (n.kind === 'db') {
    const D = dbConfig(n);
    const S = Math.min(D.shards, 4), R = Math.min(D.replicas, 3);
    if (S > 1 || R > 0) {
      right += (S - 1) * Math.max(150, R * 60 + 50) + Math.max(0, R - 1) * 30;
      if (R > 0) bottom = 150 + (k.h * 0.72) / 2;
    }
  }
  // pills: load above, name / spec below, warnings to the right
  return { left: left + 20, right: right + 40, top: top + 52, bottom: bottom + 46 };
}

/** Longest-path layering from the traffic sources, ignoring edges that close a cycle. */
function layers(nodes: DesignNode[], edges: DesignEdge[]): Map<string, number> {
  const out = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) { out.get(e.from)?.push(e.to); indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1); }

  // depth-first from users, then from anything else, marking edges that point back up the stack
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const roots = [...nodes.filter((n) => n.kind === 'users'), ...nodes.filter((n) => indeg.get(n.id) === 0), ...nodes];
  for (const r of roots) {
    if (state.get(r.id)) continue;
    const stack: [string, number][] = [[r.id, 0]];
    state.set(r.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = out.get(top[0])![top[1]++];
      if (next === undefined) { state.set(top[0], 2); stack.pop(); continue; }
      const s = state.get(next) ?? 0;
      if (s === 1) back.add(`${top[0]}>${next}`);
      else if (s === 0) { state.set(next, 1); stack.push([next, 0]); }
    }
  }

  // longest path over the remaining DAG (Kahn's algorithm)
  const level = new Map(nodes.map((n) => [n.id, 0]));
  const deg = new Map(nodes.map((n) => [n.id, 0]));
  const dag = edges.filter((e) => !back.has(`${e.from}>${e.to}`));
  for (const e of dag) deg.set(e.to, deg.get(e.to)! + 1);
  const queue = nodes.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of dag) {
      if (e.from !== id) continue;
      level.set(e.to, Math.max(level.get(e.to)!, level.get(id)! + 1));
      deg.set(e.to, deg.get(e.to)! - 1);
      if (deg.get(e.to) === 0) queue.push(e.to);
    }
  }
  return level;
}

/**
 * Left-to-right layered layout. Columns are hops from the users; inside the canvas every group
 * gets its own horizontal band (ungrouped nodes first), so a group's box never swallows
 * components that are not in it. Within a band, nodes follow their callers to cut crossings.
 */
export function layout(nodes: DesignNode[], edges: DesignEdge[], groups: string[][]) {
  const level = layers(nodes, edges);
  const ext = new Map(nodes.map((n) => [n.id, extents(n)]));

  // innermost group = the smallest group a node belongs to
  const band = new Map<string, number>();
  for (const n of nodes) {
    let best = -1;
    groups.forEach((g, i) => { if (g.includes(n.id) && (best < 0 || g.length < groups[best].length)) best = i; });
    band.set(n.id, best);
  }
  const bands = [-1, ...groups.map((_, i) => i)].filter((b) => nodes.some((n) => band.get(n.id) === b));
  const maxLevel = Math.max(0, ...level.values());

  // order inside each column: by band, then by the average position of the callers
  const order = new Map<string, number>();
  const preds = new Map(nodes.map((n) => [n.id, edges.filter((e) => e.to === n.id).map((e) => e.from)]));
  const columns: string[][] = [];
  for (let L = 0; L <= maxLevel; L++) {
    const col = nodes.filter((n) => level.get(n.id) === L).map((n, i) => {
      const ps = preds.get(n.id)!.filter((p) => order.has(p));
      return { id: n.id, b: bands.indexOf(band.get(n.id)!), bary: ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : i };
    }).sort((a, b) => a.b - b.b || a.bary - b.bary);
    col.forEach((c, i) => order.set(c.id, i));
    columns.push(col.map((c) => c.id));
  }

  // x: each column is as wide as its widest node
  const colLeft: number[] = [];
  let x = ORIGIN.x;
  for (const col of columns) {
    colLeft.push(x);
    const width = Math.max(140, ...col.map((id) => ext.get(id)!.left + ext.get(id)!.right));
    x += width + COL_GAP;
  }

  // y: bands stacked top to bottom; inside a band each column's stack is centred
  const placed = new Map<string, Placed>();
  let bandTop = ORIGIN.y;
  for (const b of bands) {
    const stacks = columns.map((col) => col.filter((id) => band.get(id) === b));
    const heightOf = (ids: string[]) => ids.reduce((s, id) => s + ext.get(id)!.top + ext.get(id)!.bottom, 0) + Math.max(0, ids.length - 1) * ROW_GAP;
    const bandH = Math.max(0, ...stacks.map(heightOf));
    stacks.forEach((ids, L) => {
      let y = bandTop + (bandH - heightOf(ids)) / 2;
      for (const id of ids) {
        const e = ext.get(id)!, n = nodes.find((m) => m.id === id)!, k = KINDS[n.kind];
        const ax = colLeft[L] + e.left, ay = y + e.top;
        placed.set(id, { x: Math.round(ax / 10) * 10, y: Math.round(ay / 10) * 10, w: k.w, h: k.h, ...e });
        y += e.top + e.bottom + ROW_GAP;
      }
    });
    bandTop += bandH + BAND_GAP;
  }

  /** Box around a set of nodes (a group), with room for its label. */
  const groupBox = (ids: string[]): Box => {
    const ps = ids.map((id) => placed.get(id)!).filter(Boolean);
    if (!ps.length) return { x: ORIGIN.x, y: ORIGIN.y, w: 320, h: 220 };
    const l = Math.min(...ps.map((p) => p.x - p.left)) - PAD, t = Math.min(...ps.map((p) => p.y - p.top)) - PAD;
    const r = Math.max(...ps.map((p) => p.x + p.right)) + PAD, btm = Math.max(...ps.map((p) => p.y + p.bottom)) + PAD;
    return { x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(btm - t) };
  };
  /** A spot below the diagram for notes that are not attached to a component. */
  const freeSpot = (i: number) => ({ x: ORIGIN.x + i * 220, y: bandTop });

  return { nodes: placed, groupBox, freeSpot };
}
