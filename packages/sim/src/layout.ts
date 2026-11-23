import type { DesignNode } from '@syslab/types';
import { KINDS, SIZE_SCALE } from './catalog';
import { dbConfig } from './factory';
import { isRingDb } from './ring';
import type { SimResult } from './simulate';

export interface Point { x: number; y: number }

export const MAX_VISIBLE_REPLICAS = 8;
export const MAX_VISIBLE_SHARDS = 4;
export const MAX_VISIBLE_DB_REPLICAS = 3;
export const DB_REPLICA_SCALE = 0.72;

/** Compute kinds with >1 replica are drawn as separate servers. */
export function isFanned(n: DesignNode, sim: SimResult): boolean {
  return !!KINDS[n.kind].canAuto && (sim.reps[n.id] ?? 1) > 1 && !sim.needsLB[n.id];
}

export function isDbCluster(n: DesignNode): boolean {
  if (n.kind !== 'db' || isRingDb(n)) return false;
  const D = dbConfig(n);
  return D.shards > 1 || D.replicas > 0;
}

export function nodeScale(n: DesignNode, sim: SimResult): number {
  return KINDS[n.kind].perCpu ? SIZE_SCALE[sim.sizeIdx[n.id] ?? n.size] ?? 1 : 1;
}

export interface DbLayout { primaries: Point[]; replicas: Point[][]; shown: { shards: number; replicas: number } }

export function dbLayout(n: DesignNode): DbLayout {
  const D = dbConfig(n);
  const S = Math.min(D.shards, MAX_VISIBLE_SHARDS), R = Math.min(D.replicas, MAX_VISIBLE_DB_REPLICAS);
  const gap = Math.max(150, R * 60 + 50);
  const primaries: Point[] = [], replicas: Point[][] = [];
  for (let s = 0; s < S; s++) {
    const p = { x: n.x + s * gap, y: n.y };
    primaries.push(p);
    replicas.push(Array.from({ length: R }, (_, j) => ({ x: p.x - (R - 1) * 30 + j * 60, y: p.y + 150 })));
  }
  return { primaries, replicas, shown: { shards: S, replicas: R } };
}

/**
 * Where each visible instance of a node is drawn. Index 0 is the anchor used for
 * labels and flows. Fanned servers form a diagonal, wrapping into a second column.
 */
export function instancePositions(n: DesignNode, sim: SimResult): Point[] {
  if (isDbCluster(n)) return dbLayout(n).primaries;
  if (!isFanned(n, sim)) return [{ x: n.x, y: n.y }];
  const visible = Math.min(sim.reps[n.id], MAX_VISIBLE_REPLICAS);
  const rows = Math.min(visible, 4);
  const y0 = n.y - (rows - 1) * 55;
  return Array.from({ length: visible }, (_, i) => ({ x: n.x + (i % 4) * 62 + Math.floor(i / 4) * 165, y: y0 + (i % 4) * 110 }));
}

export interface Segment { x: number; y: number; len: number; ang: number }

export function segment(a: Point, b: Point): Segment {
  const dx = b.x - a.x, dy = b.y - a.y;
  return { x: a.x, y: a.y, len: Math.max(1, Math.hypot(dx, dy)), ang: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** People drawn on the users platform, more as traffic grows. */
export function crowd(users: number): { x: number; y: number; c: string }[] {
  const cols = ['#a9c8ec', '#f7c99f', '#aee0ca', '#cbc7f0', '#f0dc9b', '#f2b8c6'];
  if (users < 1) return []; // nobody online: an empty platform
  const n = Math.max(3, Math.min(15, Math.round(Math.log10(Math.max(users, 1)) * 3 - 6)));
  const slots: Point[] = [];
  for (let r = -1; r <= 1; r++) for (let c = -2; c <= 2; c++) slots.push({ x: 90 + 14 * c + 14 * r, y: 60 - 7 * c + 7 * r });
  const order = [7, 6, 8, 2, 12, 1, 11, 3, 13, 5, 9, 0, 14, 4, 10];
  return order.slice(0, n)
    .map((i, j) => ({ x: slots[i].x - 6, y: slots[i].y - 26, c: cols[(i * 7 + j) % cols.length] }))
    .sort((a, b) => a.y - b.y);
}
