import type {
  AutoscaleConfig, CacheConfig, DbConfig, DesignDoc, DesignEdge, DesignNode, LbConfig, NodeKind, Requirements,
} from '@syslab/types';
import { TECHS } from './catalog';

let counter = 0;
/** Short unique id. Good enough for client-side ids inside one document. */
export function uid(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return prefix + Date.now().toString(36).slice(-5) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
}

export const DEFAULT_AUTOSCALE: AutoscaleConfig = { on: false, mode: 'h', min: 2, max: 10, minSize: 1, maxSize: 4, target: 60 };

export const DEFAULT_DB: DbConfig = {
  replicas: 0, sync: false, shards: 1, strategy: 'hash', shardKey: 'user_id', partition: 'none', partKey: 'created_at', parts: 12, maxConn: 0,
};

export const DEFAULT_LB: LbConfig = { algo: 'rr', vnodes: 10 };

export const DEFAULT_CACHE: CacheConfig = { ttl: 60 };

const DEFAULT_SIZE: Partial<Record<NodeKind, number>> = { app: 2, worker: 1, cache: 1, db: 2 };

export function makeNode(id: string, kind: NodeKind, x: number, y: number, label: string, over: Partial<DesignNode> = {}): DesignNode {
  return {
    id, kind, x, y, label,
    tech: TECHS[kind][0],
    size: DEFAULT_SIZE[kind] ?? 2,
    replicas: 1,
    down: false,
    autoscale: { ...DEFAULT_AUTOSCALE },
    ...over,
  };
}

export function makeEdge(id: string, from: string, to: string, over: Partial<DesignEdge> = {}): DesignEdge {
  return { id, from, to, mode: 'sync', proto: 'REST', op: 'both', weight: 1, route: '', ...over };
}

export const autoH = (min: number, max: number): AutoscaleConfig => ({ ...DEFAULT_AUTOSCALE, on: true, mode: 'h', min, max });
export const autoV = (minSize: number, maxSize: number): AutoscaleConfig => ({ ...DEFAULT_AUTOSCALE, on: true, mode: 'v', minSize, maxSize });

export const DEFAULT_REQUIREMENTS: Requirements = { goal: '', dau: 120000, peak: 10, read: 90, slo: 200, dataNote: '' };

export function blankDoc(over: Partial<DesignDoc> = {}): DesignDoc {
  return {
    schemaVersion: 1,
    nodes: [], edges: [], groups: [], notes: [], flows: [],
    requirements: { ...DEFAULT_REQUIREMENTS },
    users: 12000,
    lesson: null,
    ...over,
  };
}

export function usersFromRequirements(r: Requirements): number {
  return Math.max(0, Math.round((r.dau * r.peak) / 100));
}

export function dbConfig(n: DesignNode): DbConfig {
  return { ...DEFAULT_DB, ...(n.dbc ?? {}) };
}

export function lbConfig(n: DesignNode): LbConfig {
  return { ...DEFAULT_LB, ...(n.lbc ?? {}) };
}

export function cacheConfig(n: DesignNode): CacheConfig {
  return { ...DEFAULT_CACHE, ...(n.cachec ?? {}) };
}

export function autoscale(n: DesignNode): AutoscaleConfig {
  return { ...DEFAULT_AUTOSCALE, ...(n.autoscale ?? {}) };
}
