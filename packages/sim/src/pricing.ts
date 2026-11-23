import type { DesignDoc, DesignNode, NodeKind } from '@syslab/types';
import { SIZES } from './catalog';
import { dbConfig, queueConfig } from './factory';
import { isRingDb, ringConfig } from './ring';

/**
 * Cloud cost model: AWS us-east-1 on-demand list prices (USD), rounded. Real bills depend on
 * region, discounts and exact usage; the AWS Pricing Calculator gives a quote. Every number below
 * is a published list price for the named service, so the totals are realistic orders of magnitude.
 */
export const PRICING_SOURCE = 'AWS us-east-1 on-demand list prices (approx.)';
export const HOURS_PER_MONTH = 730;
export const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

/** The EC2 instance type behind each machine size (general purpose, x86). */
export const INSTANCES = [
  { type: 'c6i.large', hourly: 0.085 }, //     2 vCPU,   4 GiB
  { type: 'm6i.2xlarge', hourly: 0.384 }, //   8 vCPU,  32 GiB
  { type: 'm6i.4xlarge', hourly: 0.768 }, //  16 vCPU,  64 GiB
  { type: 'm6i.16xlarge', hourly: 3.072 }, // 64 vCPU, 256 GiB
  { type: 'm7i.48xlarge', hourly: 9.6768 }, // 192 vCPU, 768 GiB
] as const;

/** Unit prices used by the model. */
export const PRICES = {
  /** RDS (PostgreSQL / MySQL) instance-hour vs. the same EC2 size: db.m6i.large $0.171 vs m6i.large $0.096 */
  rdsPremium: 1.78,
  /** ElastiCache (Redis OSS / Memcached) node-hour vs. EC2 */
  elasticachePremium: 1.55,
  /** ElastiCache for Valkey is 20% cheaper than Redis OSS */
  valkeyPremium: 1.24,
  /** DocumentDB / managed MongoDB instance-hour vs. EC2 */
  documentPremium: 1.8,
  /** gp3 storage, $/GB-month */
  ebsGb: 0.08,
  /** RDS gp3 storage, $/GB-month */
  rdsGb: 0.115,
  /** DynamoDB on-demand: $ per million write / read request units */
  dynamoWriteM: 1.25,
  dynamoReadM: 0.25,
  /** DynamoDB storage, $/GB-month */
  dynamoGb: 0.25,
  /** S3 Standard: storage $/GB-month, GET per 1,000, PUT per 1,000 */
  s3Gb: 0.023,
  s3Get1k: 0.0004,
  s3Put1k: 0.005,
  /** Application Load Balancer: per hour + per LCU-hour */
  albHour: 0.0225,
  albLcuHour: 0.008,
  /** API Gateway HTTP API, $ per million requests */
  apiGatewayM: 1.0,
  /** CloudFront HTTPS requests, $ per 10,000 */
  cloudfront10k: 0.01,
  /** MSK broker kafka.m5.large, per hour */
  mskBrokerHour: 0.21,
  /** SQS standard, $ per million requests (a message costs send + receive + delete) */
  sqsM: 0.4,
  /** SES, $ per 1,000 emails */
  ses1k: 0.1,
  /** SNS SMS to US numbers, $ per message */
  sms: 0.00581,
} as const;

/** CloudFront data out to the internet (North America / Europe), $/GB by monthly volume tier. */
export const CLOUDFRONT_TIERS: [gb: number, perGb: number][] = [[10_240, 0.085], [40_960, 0.08], [102_400, 0.06], [358_400, 0.04], [536_576, 0.03], [4_194_304, 0.025], [Infinity, 0.02]];
/** EC2 data transfer out to the internet, $/GB by monthly volume tier (first 100 GB free). */
export const EGRESS_TIERS: [gb: number, perGb: number][] = [[100, 0], [10_240, 0.09], [40_960, 0.085], [102_400, 0.07], [Infinity, 0.05]];

/** Cost of `gb` per month under tiered per-GB pricing. */
export function tiered(gb: number, tiers: [number, number][]): number {
  let left = Math.max(0, gb), cost = 0;
  for (const [size, price] of tiers) {
    const take = Math.min(left, size);
    cost += take * price;
    left -= take;
    if (left <= 0) break;
  }
  return cost;
}

/** Sizes that cost the design money; defaults when the requirements leave them out. */
export const DEFAULT_RESP_KB = 10;
export const DEFAULT_ASSET_KB = 100;
export const DEFAULT_STORAGE_GB = 500;

export type CostCategory = 'compute' | 'database' | 'cache' | 'messaging' | 'storage' | 'network' | 'cdn' | 'third-party';

export interface NodePrice {
  monthly: number;
  category: CostCategory;
  /** how the price is made, e.g. "3 × m6i.4xlarge" */
  detail: string;
}

/** What the pricing needs from a simulation run for one node. */
export interface PriceInput {
  /** requests or messages per second arriving */
  rps: number;
  /** current machine size index */
  sizeIdx: number;
  /** current instances (replicas) */
  reps: number;
  /** share of requests that are reads (0..1) */
  read: number;
  respKb: number;
  assetKb: number;
  storageGb: number;
}

const month = (hourly: number) => hourly * HOURS_PER_MONTH;
const perMonth = (perSecond: number) => perSecond * SECONDS_PER_MONTH;
/** GB per month moved at `rps` requests of `kb` each */
const gbPerMonth = (rps: number, kb: number) => (perMonth(rps) * kb) / 1_048_576;
const tech = (n: DesignNode) => n.tech ?? '';

/** Monthly cost of one component on AWS, from its kind, technology, size and traffic. */
export function priceNode(n: DesignNode, p: PriceInput): NodePrice {
  const inst = INSTANCES[Math.max(0, Math.min(INSTANCES.length - 1, p.sizeIdx))];
  const fmtN = (count: number, type: string) => `${count} × ${type}`;
  switch (n.kind) {
    case 'users':
      return { monthly: 0, category: 'network', detail: '' };
    case 'app':
    case 'worker':
      return { monthly: month(inst.hourly) * p.reps, category: 'compute', detail: `EC2 ${fmtN(p.reps, inst.type)}` };
    case 'cache': {
      const premium = tech(n) === 'Valkey' ? PRICES.valkeyPremium : PRICES.elasticachePremium;
      return { monthly: month(inst.hourly * premium) * p.reps, category: 'cache', detail: `ElastiCache ${fmtN(p.reps, `cache.${inst.type}`)}` };
    }
    case 'db': {
      const D = dbConfig(n), servers = isRingDb(n) ? ringConfig(n).nodes : D.shards * (1 + D.replicas);
      if (tech(n) === 'DynamoDB') {
        const writes = perMonth(p.rps * (1 - p.read)) / 1e6, reads = perMonth(p.rps * p.read) / 1e6;
        return {
          monthly: writes * PRICES.dynamoWriteM + reads * PRICES.dynamoReadM + p.storageGb * PRICES.dynamoGb,
          category: 'database', detail: `DynamoDB on-demand · ${Math.round(writes)}M writes + ${Math.round(reads)}M reads`,
        };
      }
      const managed = tech(n) === 'Postgres' || tech(n) === 'MySQL' ? { premium: PRICES.rdsPremium, gb: PRICES.rdsGb, name: 'RDS' }
        : tech(n) === 'MongoDB' ? { premium: PRICES.documentPremium, gb: PRICES.rdsGb, name: 'DocumentDB' }
        : { premium: 1, gb: PRICES.ebsGb, name: 'EC2 (self-managed)' };
      return {
        monthly: (month(inst.hourly * managed.premium) + p.storageGb * managed.gb) * servers,
        category: 'database', detail: `${managed.name} ${fmtN(servers, inst.type)} + ${p.storageGb} GB each`,
      };
    }
    case 'store': {
      const gets = perMonth(p.rps * p.read) / 1000, puts = perMonth(p.rps * (1 - p.read)) / 1000;
      return {
        monthly: p.storageGb * PRICES.s3Gb + gets * PRICES.s3Get1k + puts * PRICES.s3Put1k,
        category: 'storage', detail: `S3 ${p.storageGb} GB + requests`,
      };
    }
    case 'cdn': {
      const gb = gbPerMonth(p.rps, p.assetKb);
      return {
        monthly: tiered(gb, CLOUDFRONT_TIERS) + (perMonth(p.rps) / 10_000) * PRICES.cloudfront10k,
        category: 'cdn', detail: `CloudFront ${Math.round(gb).toLocaleString('en-US')} GB/month out + requests`,
      };
    }
    case 'lb': {
      if (tech(n) === 'Nginx' || tech(n) === 'HAProxy') {
        return { monthly: month(INSTANCES[0].hourly) * 2, category: 'network', detail: `EC2 2 × ${INSTANCES[0].type} (HA pair)` };
      }
      // an LCU is the largest of: 25 new connections/s, 1 GB processed per hour, 1,000 rule evaluations/s
      const lcu = Math.max(1, p.rps / 250, (p.rps * p.respKb * 3600) / 1_048_576, p.rps / 1000);
      return { monthly: month(PRICES.albHour + lcu * PRICES.albLcuHour), category: 'network', detail: `ALB + ${Math.round(lcu)} LCU` };
    }
    case 'gateway': {
      if (tech(n) === 'AWS API Gateway') {
        return { monthly: (perMonth(p.rps) / 1e6) * PRICES.apiGatewayM, category: 'network', detail: `API Gateway ${Math.round(perMonth(p.rps) / 1e6)}M requests` };
      }
      return { monthly: month(0.096) * 2, category: 'network', detail: 'EC2 2 × m6i.large (self-hosted, HA)' };
    }
    case 'queue': {
      const t = tech(n);
      if (t === 'SQS') return { monthly: (perMonth(p.rps) * 3 / 1e6) * PRICES.sqsM, category: 'messaging', detail: `SQS ${Math.round(perMonth(p.rps) * 3 / 1e6)}M requests` };
      if (t === 'BullMQ (Redis)') return { monthly: month(0.149), category: 'messaging', detail: 'ElastiCache 1 × cache.m6g.large' };
      if (t === 'Kafka' || queueConfig(n).mode === 'pubsub') {
        const mbps = (p.rps * p.respKb) / 1024, brokers = Math.max(3, Math.ceil(mbps / 30));
        return { monthly: month(PRICES.mskBrokerHour) * brokers, category: 'messaging', detail: `MSK ${fmtN(brokers, 'kafka.m5.large')}` };
      }
      return { monthly: month(0.096) * 3, category: 'messaging', detail: 'EC2 3 × m6i.large (self-hosted cluster)' };
    }
    case 'ext': {
      const t = tech(n);
      if (t === 'Email (SES)') return { monthly: (perMonth(p.rps) / 1000) * PRICES.ses1k, category: 'third-party', detail: `SES ${Math.round(perMonth(p.rps) / 1e6)}M emails` };
      if (t === 'SMS provider') return { monthly: perMonth(p.rps) * PRICES.sms, category: 'third-party', detail: `SNS SMS ${Math.round(perMonth(p.rps) / 1e6)}M messages` };
      if (t === 'Payment gateway') return { monthly: 0, category: 'third-party', detail: 'Billed on revenue (Stripe: 2.9% + 30¢ per charge)' };
      return { monthly: 0, category: 'third-party', detail: 'Priced by the provider' };
    }
    default:
      return { monthly: 0, category: 'compute', detail: '' };
  }
}

/** Internet data transfer for responses served from the origin (not the CDN), $/month. */
export function egressCost(rps: number, respKb: number): { monthly: number; gb: number } {
  const gb = gbPerMonth(rps, respKb);
  return { monthly: tiered(gb, EGRESS_TIERS), gb };
}

/** Payload and storage sizes from the requirements, with defaults. */
export function sizesOf(doc: Pick<DesignDoc, 'requirements'>) {
  const r = doc.requirements ?? ({} as DesignDoc['requirements']);
  return {
    respKb: r.respKb && r.respKb > 0 ? r.respKb : DEFAULT_RESP_KB,
    assetKb: r.assetKb && r.assetKb > 0 ? r.assetKb : DEFAULT_ASSET_KB,
    storageGb: r.storageGb && r.storageGb > 0 ? r.storageGb : DEFAULT_STORAGE_GB,
  };
}

/** Kinds whose instances could run on cheaper capacity. */
const SPOT_OK: NodeKind[] = ['worker'];
const GRAVITON_OK: NodeKind[] = ['app', 'worker', 'cache'];

export interface CostItem { id: string; label: string; kind: NodeKind | 'egress'; category: CostCategory; monthly: number; detail: string }
export interface Saving { key: string; text: string; monthly: number }
export interface CostBreakdown {
  total: number;
  source: string;
  items: CostItem[];
  byCategory: { category: CostCategory; monthly: number }[];
  savings: Saving[];
}

/**
 * Where the money goes, and how to spend less: per component and per category, plus savings
 * that are standard on AWS (Savings Plans / reserved instances, Spot for queue workers, Graviton,
 * right-sizing idle machines).
 */
export function costBreakdown(
  doc: Pick<DesignDoc, 'nodes'>,
  sim: { nodeCost: Record<string, number>; nodeCostDetail: Record<string, NodePrice>; egress: { monthly: number; gb: number }; load: Record<string, number>; sizeIdx: Record<string, number>; reps: Record<string, number> },
): CostBreakdown {
  const items: CostItem[] = doc.nodes.filter((n) => n.kind !== 'users').map((n) => {
    const p = sim.nodeCostDetail[n.id];
    return { id: n.id, label: n.label, kind: n.kind, category: p?.category ?? 'compute', monthly: sim.nodeCost[n.id] ?? 0, detail: p?.detail ?? '' };
  });
  if (sim.egress.monthly > 0) items.push({ id: 'egress', label: 'Data transfer out', kind: 'egress', category: 'network', monthly: sim.egress.monthly, detail: `${Math.round(sim.egress.gb).toLocaleString('en-US')} GB/month from origin to users` });
  items.sort((a, b) => b.monthly - a.monthly);
  const cats = new Map<CostCategory, number>();
  for (const i of items) cats.set(i.category, (cats.get(i.category) ?? 0) + i.monthly);
  const byCategory = [...cats].map(([category, monthly]) => ({ category, monthly })).filter((c) => c.monthly > 0).sort((a, b) => b.monthly - a.monthly);
  const total = items.reduce((s, i) => s + i.monthly, 0);

  const savings: Saving[] = [];
  const of = (pred: (n: DesignNode) => boolean) => doc.nodes.filter(pred).reduce((s, n) => s + (sim.nodeCost[n.id] ?? 0), 0);
  const compute = of((n) => n.kind === 'app' || n.kind === 'worker');
  const workers = of((n) => SPOT_OK.includes(n.kind));
  const dbs = of((n) => n.kind === 'db' && n.tech !== 'DynamoDB');
  if (workers > 0) savings.push({ key: 'spot', text: 'Run queue workers on Spot instances (~65% off; a queue retries interrupted jobs)', monthly: workers * 0.65 });
  const steady = compute - workers;
  if (steady > 0) savings.push({ key: 'plan', text: '1-year Compute Savings Plan for always-on services (~28% off EC2)', monthly: steady * 0.28 });
  if (dbs > 0) savings.push({ key: 'ri', text: '1-year reserved database instances (~35% off)', monthly: dbs * 0.35 });
  const graviton = of((n) => GRAVITON_OK.includes(n.kind));
  if (graviton > 0) savings.push({ key: 'graviton', text: 'Move services, workers and caches to Graviton (arm64, ~20% cheaper per instance)', monthly: graviton * 0.2 });
  // right-size: a machine below 25% load with a smaller size available
  for (const n of doc.nodes) {
    const idx = sim.sizeIdx[n.id] ?? n.size;
    const load = sim.load[n.id] ?? 0;
    if (!['app', 'worker', 'cache', 'db'].includes(n.kind) || idx <= 0 || load <= 0 || load >= 0.25) continue;
    const now = sim.nodeCost[n.id] ?? 0, ratio = SIZES[idx - 1].cost / SIZES[idx].cost;
    savings.push({ key: `size:${n.id}`, text: `${n.label} is under 25% busy: one size smaller (${SIZES[idx - 1].cpu} vCPU) is enough`, monthly: now * (1 - ratio) });
  }
  return { total, source: PRICING_SOURCE, items, byCategory, savings: savings.filter((s) => s.monthly >= 1).sort((a, b) => b.monthly - a.monthly) };
}
