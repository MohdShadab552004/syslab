import type { DesignDoc, TemplateKey } from '@syslab/types';
import { autoH, blankDoc, makeEdge as ed, makeNode as mk } from './factory';

export interface TemplateMeta {
  key: TemplateKey;
  name: string;
  desc: string;
  previewKinds: DesignDoc['nodes'][number]['kind'][];
}

export const TEMPLATES: TemplateMeta[] = [
  { key: 'blank', name: 'Blank canvas', desc: 'Start with just your users.', previewKinds: ['users'] },
  { key: 'url', name: 'URL Shortener', desc: 'Read-heavy, cache and a key service.', previewKinds: ['app', 'cache', 'db'] },
  { key: 'chat', name: 'Chat App', desc: 'WebSockets, Kafka fan-out, Cassandra.', previewKinds: ['gateway', 'queue', 'worker'] },
  { key: 'ecom', name: 'E-commerce', desc: 'Autoscaling API, payments, a VPC.', previewKinds: ['cdn', 'app', 'ext'] },
  { key: 'lesson', name: 'Lesson: Horizontal Scaling', desc: 'Guided, 8 steps, 11 min.', previewKinds: ['lb', 'app', 'app'] },
];

export interface LessonStep { n: number; label: string; caption: string }

export const HORIZONTAL_SCALING_STEPS: LessonStep[] = [
  { n: 1, label: 'One server', caption: '1,000 users on a single 8 vCPU box. Plenty of headroom.' },
  { n: 2, label: 'Scale up', caption: '100,000 users. Buy a bigger machine: 64 vCPU, still one box.' },
  { n: 3, label: 'The ceiling', caption: '500,000 users on the largest machine you can buy. CPU is pegged and requests fail.' },
  { n: 4, label: 'Scale out', caption: 'A load balancer splits traffic across four servers. Nobody is maxed out.' },
  { n: 5, label: 'Night time', caption: 'Traffic falls to 40,000 at night, but you still pay for all four servers.' },
  { n: 6, label: 'Autoscale', caption: 'One autoscaling group grows and shrinks with load. Drag traffic and watch it react.' },
  { n: 7, label: 'Add cache', caption: 'Reads hit the cache first. Only misses and writes reach the database.' },
  { n: 8, label: 'Flash sale', caption: '2,000,000 users at once. Servers scale out, so what breaks next?' },
];

/** Graph for one step of the Horizontal Scaling lesson. */
export function lessonStep(step: number): Pick<DesignDoc, 'nodes' | 'edges' | 'users'> {
  const users = [1000, 100000, 500000, 500000, 40000, 500000, 500000, 2000000][step - 1] ?? 1000;
  if (step <= 3) {
    return {
      users,
      nodes: [mk('u', 'users', 240, 470, 'Users'), mk('a', 'app', 580, 420, 'App Server', { size: [1, 3, 4][step - 1] })],
      edges: [ed('e1', 'u', 'a')],
    };
  }
  if (step <= 5) {
    return {
      users,
      nodes: [
        mk('u', 'users', 120, 500, 'Users'), mk('lb', 'lb', 330, 500, 'Load Balancer'),
        mk('a', 'app', 500, 250, 'Server A', { size: 3 }), mk('b', 'app', 565, 370, 'Server B', { size: 3 }),
        mk('c', 'app', 630, 490, 'Server C', { size: 3 }), mk('d', 'app', 695, 610, 'Server D', { size: 3 }),
      ],
      edges: [ed('e1', 'u', 'lb'), ed('e2', 'lb', 'a'), ed('e3', 'lb', 'b'), ed('e4', 'lb', 'c'), ed('e5', 'lb', 'd')],
    };
  }
  const nodes = [mk('u', 'users', 140, 480, 'Users'), mk('lb', 'lb', 340, 480, 'Load Balancer'), mk('a', 'app', 560, 450, 'Server', { size: 3, autoscale: autoH(2, 20) })];
  const edges = [ed('e1', 'u', 'lb'), ed('e2', 'lb', 'a')];
  if (step >= 7) {
    nodes.push(mk('k', 'cache', 1010, 320, 'Cache', { size: 2 }), mk('db', 'db', 1020, 600, 'Database', { size: 3 }));
    edges.push(ed('e3', 'a', 'k', { proto: 'TCP' }), ed('e4', 'k', 'db', { proto: 'TCP' }));
  }
  return { users, nodes, edges };
}

export interface TemplateResult { name: string; doc: DesignDoc }

export function buildTemplate(key: TemplateKey): TemplateResult {
  switch (key) {
    case 'lesson': {
      const s = lessonStep(1);
      return {
        name: 'Lesson: Horizontal Scaling',
        doc: blankDoc({ ...s, lesson: { id: 'horizontal-scaling', step: 1 }, requirements: { goal: 'Buy a bigger one, or more of them?', dau: 10000, peak: 10, read: 90, slo: 300, dataNote: '' } }),
      };
    }
    case 'url':
      return {
        name: 'URL Shortener',
        doc: blankDoc({
          users: 50000,
          requirements: { goal: 'Shorten links and redirect in under 100 ms', dau: 1000000, peak: 5, read: 95, slo: 100, dataNote: '~500M links over 5 yrs' },
          nodes: [
            mk('u', 'users', 150, 440, 'Users', { tech: 'Web + Mobile' }), mk('lb', 'lb', 350, 440, 'Load Balancer'),
            mk('api', 'app', 570, 340, 'Shortener API', { tech: 'Go', autoscale: autoH(2, 8) }),
            mk('kg', 'app', 570, 620, 'Key Generator', { tech: 'Go', size: 0 }),
            mk('k', 'cache', 810, 260, 'Link Cache', { tech: 'Redis' }),
            mk('db', 'db', 830, 520, 'Link Store', { tech: 'Cassandra', size: 3, dbc: { replicas: 2, shards: 3, strategy: 'hash', shardKey: 'short_code' } }),
          ],
          edges: [
            ed('e1', 'u', 'lb'), ed('e2', 'lb', 'api'), ed('e3', 'api', 'k', { proto: 'TCP', op: 'read', weight: 9 }),
            ed('e4', 'k', 'db', { proto: 'TCP', op: 'read' }), ed('e5', 'api', 'db', { proto: 'TCP', op: 'write' }),
            ed('e6', 'api', 'kg', { proto: 'gRPC', op: 'write' }),
          ],
          notes: [{ id: 'nt1', text: 'Reads beat writes ~100:1. Keep hot links in the cache.', x: 970, y: 230 }],
          flows: [
            { id: 'f1', name: 'Open short link', steps: ['u', 'lb', 'api', 'k', 'db'] },
            { id: 'f2', name: 'Create short link', steps: ['u', 'lb', 'api', 'kg', 'api', 'db'] },
          ],
        }),
      };
    case 'chat':
      return {
        name: 'Chat App',
        doc: blankDoc({
          users: 50000,
          requirements: { goal: 'Deliver 1:1 messages in real time', dau: 500000, peak: 10, read: 30, slo: 150, dataNote: '~40 msgs / user / day' },
          nodes: [
            mk('u', 'users', 140, 450, 'Users', { tech: 'Mobile app' }), mk('lb', 'lb', 340, 450, 'WS Load Balancer', { tech: 'HAProxy' }),
            mk('gw', 'gateway', 550, 330, 'WebSocket Gateway', { tech: 'Custom' }),
            mk('cs', 'app', 560, 590, 'Chat Service', { tech: 'Go', autoscale: autoH(2, 10) }),
            mk('pr', 'cache', 800, 250, 'Presence', { tech: 'Redis' }), mk('q', 'queue', 810, 500, 'Message Bus', { tech: 'Kafka' }),
            mk('fw', 'worker', 1050, 360, 'Fan-out Worker', { tech: 'BullMQ', size: 3, autoscale: autoH(2, 20) }),
            mk('mdb', 'db', 1060, 610, 'Messages DB', { tech: 'Cassandra', size: 4 }),
          ],
          edges: [
            ed('e1', 'u', 'lb', { proto: 'WebSocket' }), ed('e2', 'lb', 'gw', { proto: 'WebSocket' }),
            ed('e3', 'gw', 'cs', { proto: 'gRPC', weight: 8, route: '/chat' }), ed('e4', 'gw', 'pr', { proto: 'TCP', weight: 2, route: '/presence' }),
            ed('e5', 'cs', 'q', { mode: 'async', proto: 'Pub/Sub', op: 'write' }), ed('e6', 'q', 'fw', { mode: 'async', proto: 'Pub/Sub' }),
            ed('e7', 'fw', 'mdb', { proto: 'TCP', op: 'write' }),
          ],
          groups: [{ id: 'g1', label: 'Realtime tier', x: 460, y: 250, w: 220, h: 500, color: 'orange' }],
          flows: [
            { id: 'f1', name: 'Send message', steps: ['u', 'lb', 'gw', 'cs', 'q', 'fw', 'mdb'] },
            { id: 'f2', name: 'Deliver to receiver', steps: ['fw', 'gw', 'lb', 'u'] },
          ],
        }),
      };
    case 'ecom':
      return {
        name: 'E-commerce checkout',
        doc: blankDoc({
          users: 30000,
          requirements: { goal: 'Sell products, take payments, send receipts', dau: 300000, peak: 10, read: 85, slo: 300, dataNote: '~2M orders / yr' },
          nodes: [
            mk('u', 'users', 130, 480, 'Shoppers', { tech: 'Web + Mobile' }), mk('cdn', 'cdn', 150, 260, 'CDN', { tech: 'Cloudflare' }),
            mk('lb', 'lb', 350, 480, 'Load Balancer', { tech: 'AWS ALB' }),
            mk('api', 'app', 570, 420, 'Store API', { tech: 'Node.js', autoscale: autoH(2, 12) }),
            mk('k', 'cache', 800, 290, 'Product Cache', { tech: 'Redis' }),
            mk('odb', 'db', 810, 530, 'Orders DB', { tech: 'Postgres', size: 3, dbc: { replicas: 2, partition: 'time', partKey: 'created_at', parts: 12 } }),
            mk('q', 'queue', 590, 720, 'Order Events', { tech: 'BullMQ (Redis)' }),
            mk('w', 'worker', 880, 790, 'Order Worker', { tech: 'BullMQ', size: 1 }),
            mk('pay', 'ext', 1080, 640, 'Payments', { tech: 'Payment gateway' }), mk('mail', 'ext', 1090, 810, 'Email', { tech: 'Email (SES)' }),
          ],
          edges: [
            ed('e1', 'u', 'cdn', { op: 'read', weight: 4 }), ed('e2', 'u', 'lb', { weight: 6 }), ed('e3', 'lb', 'api'),
            ed('e4', 'api', 'k', { proto: 'TCP', op: 'read', weight: 7 }), ed('e5', 'api', 'odb', { proto: 'TCP', op: 'write', weight: 2 }),
            ed('e6', 'api', 'q', { mode: 'async', proto: 'Pub/Sub', op: 'write' }), ed('e7', 'k', 'odb', { proto: 'TCP', op: 'read' }),
            ed('e8', 'q', 'w', { mode: 'async', proto: 'Pub/Sub' }), ed('e9', 'w', 'pay', { op: 'write' }), ed('e10', 'w', 'mail', { op: 'write' }),
          ],
          groups: [{ id: 'g1', label: 'VPC · ap-south-1 (Mumbai)', x: 260, y: 215, w: 680, h: 640, color: 'blue' }],
          notes: [{ id: 'nt1', text: 'Payments are async: checkout returns fast, the worker confirms later.', x: 990, y: 240 }],
          flows: [
            { id: 'f1', name: 'Checkout', steps: ['u', 'lb', 'api', 'odb', 'api', 'q', 'w', 'pay'] },
            { id: 'f2', name: 'Product page (cache miss)', steps: ['u', 'lb', 'api', 'k', 'odb'] },
          ],
        }),
      };
    case 'blank':
    default:
      return { name: 'Untitled design', doc: blankDoc({ nodes: [mk('u', 'users', 220, 440, 'Users')] }) };
  }
}
