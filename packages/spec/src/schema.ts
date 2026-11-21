import { z } from 'zod';

/**
 * The SysLab Design Spec: what an LLM (or a person) writes to describe a system.
 * Everything refers to components by *name*; there are no ids and no coordinates —
 * SysLab assigns ids and lays the diagram out automatically.
 *
 * The `.describe()` texts are sent to the LLM as part of the tool schema, so they are
 * written as instructions.
 */

export const KIND_VALUES = ['users', 'cdn', 'lb', 'gateway', 'app', 'worker', 'cache', 'db', 'store', 'queue', 'ext'] as const;
export const SIZE_VALUES = ['2vCPU', '8vCPU', '16vCPU', '64vCPU', '192vCPU'] as const;
export const PROTOCOL_VALUES = ['REST', 'gRPC', 'WebSocket', 'Webhook', 'TCP', 'Pub/Sub'] as const;
export const LB_ALGORITHM_VALUES = ['round_robin', 'weighted', 'least_connections', 'ip_hash'] as const;
export const COLOR_VALUES = ['blue', 'green', 'orange', 'gray'] as const;

const name = z.string().trim().min(1).max(60);

export const ComponentSpec = z.object({
  name: name.describe('Unique, short display name, e.g. "Feed Service". Connections, groups and flows refer to this name.'),
  kind: z.enum(KIND_VALUES).describe(
    'users = traffic source (exactly one is typical); cdn; lb = load balancer; gateway = API gateway with path routing; '
    + 'app = API/service server; worker = background consumer; cache = Redis/Memcached; db = database; '
    + 'store = object storage like S3; queue = Kafka/SQS/RabbitMQ; ext = third-party API (payments, email, LLM).',
  ),
  tech: z.string().trim().max(60).optional().describe('Technology label, e.g. "Go", "Postgres", "Kafka", "Stripe".'),
  size: z.enum(SIZE_VALUES).optional().describe('Machine size for app, worker, cache and db. Bigger = more capacity and cost. Default 16vCPU.'),
  replicas: z.number().int().min(1).max(20).optional().describe('Fixed number of identical instances (app/worker/cache). A replicated app needs a load balancer, gateway or queue in front.'),
  autoscale: z.object({
    mode: z.enum(['horizontal', 'vertical']).optional().describe('horizontal = add servers (default), vertical = bigger machine.'),
    min: z.number().int().min(1).max(50).optional().describe('horizontal: fewest servers'),
    max: z.number().int().min(1).max(50).optional().describe('horizontal: most servers'),
    minSize: z.enum(SIZE_VALUES).optional().describe('vertical: smallest machine'),
    maxSize: z.enum(SIZE_VALUES).optional().describe('vertical: largest machine'),
    targetCpu: z.number().int().min(30).max(95).optional().describe('scale when CPU passes this %, default 60'),
  }).optional().describe('Only for kind app or worker.'),
  database: z.object({
    shards: z.number().int().min(1).max(8).optional(),
    readReplicas: z.number().int().min(0).max(5).optional(),
    syncReplication: z.boolean().optional().describe('true = writes wait for replicas (slower, never stale)'),
    shardKey: z.string().trim().max(40).optional(),
    shardStrategy: z.enum(['hash', 'range', 'geo']).optional(),
  }).optional().describe('Only for kind db.'),
  loadBalancer: z.object({
    algorithm: z.enum(LB_ALGORITHM_VALUES).optional(),
    virtualNodes: z.union([z.literal(1), z.literal(10), z.literal(100)]).optional().describe('ip_hash only'),
  }).optional().describe('Only for kind lb.'),
  offline: z.boolean().optional().describe('Start this component switched off (to show a failure).'),
});

export const ConnectionSpec = z.object({
  from: name.describe('Name of the caller component'),
  to: name.describe('Name of the called component'),
  async: z.boolean().optional().describe('true for fire-and-forget (queues, events). Default false.'),
  protocol: z.enum(PROTOCOL_VALUES).optional().describe('Default REST.'),
  carries: z.enum(['read', 'write', 'both']).optional().describe('For connections into databases: which traffic it carries. Default both.'),
  weight: z.number().int().min(1).max(10).optional().describe('Share of the caller\'s traffic relative to its other connections. Default 1.'),
  route: z.string().trim().max(60).optional().describe('Gateway path such as "/orders/*" (only from a gateway).'),
});

export const GroupSpec = z.object({
  name: name.describe('Label, e.g. "AWS us-east-1" or "Data tier"'),
  members: z.array(name).min(1).max(200).describe('Component names inside this group'),
  color: z.enum(COLOR_VALUES).optional(),
  collapsed: z.boolean().optional().describe('Show the group as one summary card'),
});

export const FlowSpec = z.object({
  name: name.describe('e.g. "Checkout" or "Open home feed"'),
  steps: z.array(name).min(2).max(30).describe('Component names in the order one request visits them'),
});

export const NoteSpec = z.object({
  text: z.string().trim().min(1).max(280),
  near: name.optional().describe('Component name the sticky note should sit next to'),
});

export const DesignSpec = z.object({
  name: z.string().trim().min(1).max(120).describe('Design title'),
  goal: z.string().trim().max(200).optional().describe('One line: what the system does'),
  users: z.number().int().min(0).max(100_000_000).optional().describe('Peak concurrent users driving the simulation. Default: dailyActiveUsers x 10%, or 12,000.'),
  dailyActiveUsers: z.number().int().min(0).max(5_000_000_000).optional(),
  readPercent: z.number().int().min(0).max(100).optional().describe('Share of requests that are reads. Default 90.'),
  latencyTargetMs: z.number().int().min(1).max(60_000).optional().describe('P95 latency SLO. Default 200.'),
  components: z.array(ComponentSpec).min(1).max(200),
  connections: z.array(ConnectionSpec).max(800).default([]),
  groups: z.array(GroupSpec).max(50).default([]),
  flows: z.array(FlowSpec).max(50).default([]),
  notes: z.array(NoteSpec).max(50).default([]),
});

export type DesignSpecInput = z.input<typeof DesignSpec>;
export type DesignSpec = z.output<typeof DesignSpec>;
export type ComponentSpec = z.output<typeof ComponentSpec>;
