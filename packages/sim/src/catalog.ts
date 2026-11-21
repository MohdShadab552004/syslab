import type { GroupColor, NodeKind, Shape } from '@syslab/types';

export interface KindSpec {
  name: string;
  shape: Shape;
  w: number;
  h: number;
  /** base latency added per hop, ms */
  lat: number;
  /** fraction of served traffic passed downstream */
  pass: number;
  /** rps per vCPU for sized kinds */
  perCpu?: number;
  /** fixed rps capacity per replica for unsized kinds */
  cap?: number;
  /** fixed monthly cost per replica for unsized kinds */
  fixed?: number;
  costMul?: number;
  canAuto?: boolean;
  async?: boolean;
  desc: string;
  colors: [string, string, string];
  tile?: string;
}

export const KINDS: Record<NodeKind, KindSpec> = {
  users:   { name: 'Users', shape: 'users', w: 180, h: 120, lat: 0, pass: 1, cap: Infinity, fixed: 0, desc: 'Traffic source', colors: ['#f4f3ef', '#e2e0d9', '#d3d0c7'], tile: '#eceae4' },
  cdn:     { name: 'CDN', shape: 'cube', w: 100, h: 100, lat: 6, pass: 0.35, cap: 200000, fixed: 80, desc: 'Edge cache, static files', colors: ['#d3eef0', '#a9dce1', '#8ccdd4'] },
  lb:      { name: 'Load Balancer', shape: 'slab', w: 124, h: 100, lat: 1, pass: 1, cap: 120000, fixed: 25, desc: 'Spreads requests', colors: ['#e6eaf0', '#cdd5e0', '#b9c3d1'] },
  gateway: { name: 'API Gateway', shape: 'gate', w: 96, h: 150, lat: 4, pass: 1, cap: 60000, fixed: 60, desc: 'Routes requests to services', colors: ['#eef1fd', '#d3dbf7', '#b6c2ee'], tile: '#d3dbf7' },
  app:     { name: 'App Server', shape: 'cube', w: 112, h: 112, lat: 38, pass: 1, perCpu: 150, canAuto: true, desc: 'Runs your API', colors: ['#d3e3f6', '#a9c8ec', '#8db3e2'] },
  worker:  { name: 'Worker', shape: 'cube', w: 104, h: 104, lat: 20, pass: 1, perCpu: 60, canAuto: true, desc: 'Background jobs', colors: ['#efe6da', '#ddcbb4', '#cdb597'] },
  cache:   { name: 'Cache', shape: 'cube', w: 100, h: 100, lat: 1, pass: 0.2, perCpu: 5000, costMul: 0.6, desc: 'Fast reads', colors: ['#d5f0e4', '#aee0ca', '#93d2b7'] },
  db:      { name: 'Database', shape: 'db', w: 104, h: 120, lat: 9, pass: 1, perCpu: 120, costMul: 1.4, desc: 'Source of truth', colors: ['#e6e4f8', '#cbc7f0', '#b4afe6'] },
  store:   { name: 'Object Storage', shape: 'slab', w: 124, h: 100, lat: 25, pass: 1, cap: 50000, fixed: 30, desc: 'Files, images, backups', colors: ['#e9efe0', '#d0dcbd', '#bccb9f'] },
  queue:   { name: 'Queue', shape: 'queue', w: 146, h: 142, lat: 2, pass: 1, cap: 400000, fixed: 40, async: true, desc: 'Buffers async work', colors: ['#f8eec8', '#f0dc9b', '#e7cd7c'] },
  ext:     { name: 'External API', shape: 'cube', w: 104, h: 104, lat: 150, pass: 1, cap: 3000, fixed: 0, desc: 'Payments, email, 3rd party', colors: ['#f1efe8', '#dedbd0', '#cbc7ba'] },
};

export const HOT_COLORS: [string, string, string] = ['#f2dbe3', '#e5c0cf', '#d7a9bc'];
export const DOWN_COLORS: [string, string, string] = ['#ececea', '#d9d9d6', '#c8c8c4'];
export const REPLICA_COLORS: [string, string, string] = ['#f1effb', '#dcd8f5', '#cbc6ef'];

export interface SizeSpec { cpu: number; ram: number; cost: number }

export const SIZES: SizeSpec[] = [
  { cpu: 2, ram: 4, cost: 60 },
  { cpu: 8, ram: 32, cost: 240 },
  { cpu: 16, ram: 64, cost: 600 },
  { cpu: 64, ram: 256, cost: 2400 },
  { cpu: 192, ram: 768, cost: 7200 },
];

/** visual scale of a sized cube, by size index */
export const SIZE_SCALE = [0.8, 0.9, 1, 1.12, 1.26];

export const TECHS: Record<NodeKind, string[]> = {
  users: ['Web app', 'Mobile app', 'Web + Mobile'],
  cdn: ['Cloudflare', 'CloudFront', 'Fastly'],
  lb: ['Nginx', 'HAProxy', 'AWS ALB', 'GCP Load Balancer'],
  gateway: ['Kong', 'AWS API Gateway', 'Envoy', 'Custom'],
  app: ['Node.js', 'Go', 'Java', 'Python'],
  worker: ['BullMQ', 'Celery', 'Sidekiq', 'Lambda'],
  cache: ['Redis', 'Memcached', 'Valkey'],
  db: ['Postgres', 'MySQL', 'MongoDB', 'Cassandra', 'DynamoDB'],
  store: ['S3', 'Cloudflare R2', 'GCS'],
  queue: ['Kafka', 'RabbitMQ', 'SQS', 'BullMQ (Redis)'],
  ext: ['Payment gateway', 'Email (SES)', 'SMS provider', 'Third-party API'],
};

export const ICONS: Record<NodeKind, string> = {
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.1a3.5 3.5 0 0 1 0 6.8',
  cdn: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z',
  lb: 'M3 12h6l4-6h8M9 12l4 6h8M18 3l3 3-3 3M18 15l3 3-3 3',
  gateway: 'M4 9h16M4 15h16M9 4v16M15 4v16',
  app: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h2M8 17h2',
  worker: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  cache: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  db: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  store: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  queue: 'M3 7h4v10H3zM10 7h4v10h-4zM17 7h4v10h-4z',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};

export const GROUP_COLORS: Record<GroupColor, { name: string; border: string; bg: string; swatch: string }> = {
  blue: { name: 'Blue', border: '#7aa3dd', bg: 'rgba(122,163,221,0.07)', swatch: '#cfe0f5' },
  green: { name: 'Green', border: '#6fb38f', bg: 'rgba(111,179,143,0.08)', swatch: '#cdeedd' },
  orange: { name: 'Orange', border: '#dc9a5b', bg: 'rgba(220,154,91,0.08)', swatch: '#fbe0c4' },
  gray: { name: 'Grey', border: '#9a978e', bg: 'rgba(154,151,142,0.07)', swatch: '#e4e2db' },
};

export const PALETTE_GROUPS: { title: string; kinds: NodeKind[] }[] = [
  { title: 'Clients & edge', kinds: ['users', 'cdn', 'lb', 'gateway'] },
  { title: 'Compute', kinds: ['app', 'worker'] },
  { title: 'Data', kinds: ['cache', 'db', 'store'] },
  { title: 'Async & external', kinds: ['queue', 'ext'] },
];

export type PresetKey = 'asgH' | 'asgV';

export const PRESETS: { key: PresetKey; name: string; desc: string; icon: string }[] = [
  { key: 'asgH', name: 'Horizontal autoscaling', desc: 'Load balancer + servers that scale out / in', icon: 'M3 12h4M7 12l4-5h3M7 12l4 5h3M15 4h6v6h-6zM15 14h6v6h-6z' },
  { key: 'asgV', name: 'Vertical autoscaling', desc: 'One server that grows / shrinks', icon: 'M7 17h10V7H7zM4 20l3-3M20 4l-3 3M14 4h6v6' },
];

/** world size of the canvas, px */
export const WORLD = { w: 1240, h: 900 };

/** requests per second generated per concurrent user */
export const RPS_PER_USER = 0.06;
