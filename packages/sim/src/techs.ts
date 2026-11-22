import type { DesignNode, NodeKind } from '@syslab/types';

/**
 * How a technology changes a component, relative to the kind's baseline (Node.js app, Postgres,
 * Redis, Kafka...). Rough multipliers taken from public benchmarks (TechEmpower, vendor numbers,
 * documented limits); real numbers depend on the workload, so the inspector lets you override them
 * with a measured capacity.
 */
export interface TechProfile {
  /** capacity multiplier (requests/s per instance) */
  cap: number;
  /** service time multiplier */
  lat: number;
  /** default max connections per database server (SQL databases); absent = no connection limit */
  conn?: number;
  /** queues: every subscriber gets every message by default (topics), instead of sharing them */
  pubsub?: boolean;
  /** one line shown in the inspector */
  note: string;
}

const BASE: TechProfile = { cap: 1, lat: 1, note: '' };

export const TECH_PROFILES: Partial<Record<NodeKind, Record<string, TechProfile>>> = {
  app: {
    'Node.js': { cap: 1, lat: 1, note: 'Single-threaded event loop per process; great for I/O-heavy APIs.' },
    Go: { cap: 1.6, lat: 0.75, note: 'Compiled with cheap goroutines; roughly 1.6× Node.js on typical JSON APIs.' },
    Java: { cap: 1.4, lat: 0.85, note: 'JIT-compiled and multi-threaded; fast once warmed up.' },
    Python: { cap: 0.55, lat: 1.4, note: 'Interpreted; about half the throughput of Node.js for the same CPU.' },
  },
  worker: {
    BullMQ: { cap: 1, lat: 1, note: 'Node.js job queue on Redis.' },
    Celery: { cap: 0.7, lat: 1.2, note: 'Python workers; slower per CPU.' },
    Sidekiq: { cap: 0.8, lat: 1.1, note: 'Ruby threads; efficient for I/O-bound jobs.' },
    Lambda: { cap: 1, lat: 1.3, note: 'Serverless; cold starts add latency.' },
  },
  cache: {
    Redis: { cap: 1, lat: 1, note: 'Single-threaded command loop; ~100k+ ops/s per core.' },
    Memcached: { cap: 1.3, lat: 0.9, note: 'Multi-threaded; scales across cores for simple get/set.' },
    Valkey: { cap: 1.2, lat: 1, note: 'Redis fork with multi-threaded I/O.' },
  },
  db: {
    Postgres: { cap: 1, lat: 1, conn: 100, note: 'Default max_connections is 100; each connection is a process.' },
    MySQL: { cap: 1.1, lat: 0.95, conn: 151, note: 'Default max_connections is 151; thread per connection.' },
    MongoDB: { cap: 1.2, lat: 1.1, note: 'Document store; no small connection cap by default.' },
    Cassandra: { cap: 1.8, lat: 1.3, note: 'Write-optimised (LSM tree); reads cost more; scales by adding nodes.' },
    DynamoDB: { cap: 3, lat: 0.9, note: 'Managed and partitioned; scales with provisioned capacity.' },
  },
  queue: {
    Kafka: { cap: 1, lat: 1, pubsub: true, note: 'Partitioned log; every consumer group reads every message at its own pace.' },
    RabbitMQ: { cap: 0.12, lat: 1.5, note: 'Broker with per-message acks; a work queue by default (fan-out needs an exchange).' },
    SQS: { cap: 0.3, lat: 10, note: 'Managed work queue: each message goes to one consumer; ~10–20 ms per call.' },
    'BullMQ (Redis)': { cap: 0.15, lat: 1.5, note: 'Job queue on one Redis; bounded by that Redis.' },
  },
  lb: {
    Nginx: { cap: 1, lat: 1, note: '' },
    HAProxy: { cap: 1.2, lat: 0.9, note: 'Very efficient L4/L7 proxy.' },
    'AWS ALB': { cap: 2, lat: 2, note: 'Managed; scales automatically, adds a few ms.' },
    'GCP Load Balancer': { cap: 2, lat: 2, note: 'Managed global LB; scales automatically.' },
  },
  gateway: {
    Kong: { cap: 1, lat: 1, note: '' },
    'AWS API Gateway': { cap: 0.17, lat: 3, note: 'Default quota is 10,000 requests/s per account and region.' },
    Envoy: { cap: 1.5, lat: 0.5, note: 'C++ proxy; very low overhead.' },
    Custom: { cap: 1, lat: 1, note: '' },
  },
  ext: {
    'Payment gateway': { cap: 0.2, lat: 2, note: 'Rate limited (hundreds of requests/s) and slow (~300 ms).' },
    'Email (SES)': { cap: 0.1, lat: 0.5, note: 'Sending quota; ask the provider to raise it.' },
    'SMS provider': { cap: 0.05, lat: 1.3, note: 'Low per-second sending limits.' },
    'Third-party API': { cap: 1, lat: 1, note: '' },
  },
};

/** Profile for a node's technology; unknown or custom technologies use the kind's baseline. */
export function techProfile(n: Pick<DesignNode, 'kind' | 'tech'>): TechProfile {
  return TECH_PROFILES[n.kind]?.[n.tech] ?? BASE;
}
