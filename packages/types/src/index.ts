/* ------------------------------------------------------------------ */
/*  Domain model shared by web, api and the simulation engine.         */
/* ------------------------------------------------------------------ */

export type NodeKind =
  | 'users' | 'cdn' | 'lb' | 'gateway' | 'app' | 'worker'
  | 'cache' | 'db' | 'store' | 'queue' | 'ext';

export type Shape = 'cube' | 'slab' | 'db' | 'queue' | 'users' | 'gate';

export type AutoscaleMode = 'h' | 'v';

export interface AutoscaleConfig {
  on: boolean;
  mode: AutoscaleMode;
  /** horizontal: replica bounds */
  min: number;
  max: number;
  /** vertical: instance size index bounds */
  minSize: number;
  maxSize: number;
  /** CPU % that triggers scaling */
  target: number;
}

export type ShardStrategy = 'hash' | 'range' | 'geo';
export type PartitionStrategy = 'none' | 'time' | 'list' | 'hash';

export interface DbConfig {
  replicas: number;
  sync: boolean;
  shards: number;
  strategy: ShardStrategy;
  shardKey: string;
  partition: PartitionStrategy;
  partKey: string;
  parts: number;
}

/**
 * How a load balancer picks a backend.
 * rr: take turns · wrr: by connection weight · lc: fewest open connections · hash: consistent hash of client IP
 */
export type LbAlgorithm = 'rr' | 'wrr' | 'lc' | 'hash';

export interface LbConfig {
  algo: LbAlgorithm;
  /** hash only: points per backend on the hash ring (more = more even spread) */
  vnodes: number;
}

export interface DesignNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  label: string;
  tech: string;
  /** index into SIZES */
  size: number;
  replicas: number;
  down: boolean;
  autoscale: AutoscaleConfig;
  dbc?: Partial<DbConfig>;
  /** load balancer settings (kind 'lb' only) */
  lbc?: Partial<LbConfig>;
}

export type EdgeMode = 'sync' | 'async';
export type Protocol = 'REST' | 'gRPC' | 'WebSocket' | 'Webhook' | 'TCP' | 'Pub/Sub';
export type EdgeOp = 'read' | 'write' | 'both';

export interface DesignEdge {
  id: string;
  from: string;
  to: string;
  mode: EdgeMode;
  proto: Protocol;
  op: EdgeOp;
  weight: number;
  route: string;
}

export type GroupColor = 'blue' | 'green' | 'orange' | 'gray';

export interface DesignGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: GroupColor;
  /** drawn as a small summary card; members are hidden (still simulated) */
  collapsed?: boolean;
}

export interface DesignNote {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface DesignFlow {
  id: string;
  name: string;
  steps: string[];
}

export interface Requirements {
  goal: string;
  dau: number;
  /** % of DAU online at peak */
  peak: number;
  /** % of requests that are reads */
  read: number;
  /** P95 latency target, ms */
  slo: number;
  dataNote: string;
}

/** The full editable document. Stored as one JSON column. */
export interface DesignDoc {
  schemaVersion: 1;
  nodes: DesignNode[];
  edges: DesignEdge[];
  groups: DesignGroup[];
  notes: DesignNote[];
  flows: DesignFlow[];
  requirements: Requirements;
  /** peak concurrent users driving the simulation */
  users: number;
  lesson?: { id: string; step: number } | null;
}

export type TemplateKey = 'blank' | 'url' | 'chat' | 'ecom' | 'lesson';

/* ------------------------------------------------------------------ */
/*  API contracts                                                      */
/* ------------------------------------------------------------------ */

export interface DesignSummary {
  id: string;
  name: string;
  isLesson: boolean;
  nodeCount: number;
  flowCount: number;
  previewKinds: NodeKind[];
  updatedAt: string;
}

export interface Design {
  id: string;
  name: string;
  doc: DesignDoc;
  revision: number;
  shareEnabled: boolean;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDesignInput {
  name?: string;
  template: TemplateKey;
}

export interface UpdateDesignInput {
  name?: string;
  doc?: DesignDoc;
  /** optimistic concurrency: the revision the client edited */
  revision: number;
}

export interface UpdateDesignResult {
  revision: number;
  updatedAt: string;
}

export interface DesignVersion {
  id: string;
  name: string;
  note: string;
  createdAt: string;
}

export interface CreateVersionInput {
  name?: string;
}

export interface ShareState {
  shareEnabled: boolean;
  shareToken: string | null;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}
