import type { NodeKind } from '@syslab/types';
import { KINDS, SIZES } from '@syslab/sim';
import { SIZE_VALUES } from './schema';

/** What each component kind is and how much it can take, for an LLM picking components. */
export function componentCatalog() {
  return (Object.keys(KINDS) as NodeKind[]).map((kind) => {
    const k = KINDS[kind];
    const capacity = kind === 'users' ? 'generates traffic (0.06 requests/s per concurrent user)'
      : k.perCpu ? `${k.perCpu} requests/s per vCPU (16vCPU ≈ ${k.perCpu * 16}/s), sized`
      : `${k.cap} requests/s per instance, fixed size`;
    return {
      kind,
      name: k.name,
      use: k.desc,
      capacity,
      latencyMs: k.lat,
      canAutoscale: !!k.canAuto,
      async: !!k.async,
    };
  });
}

export const SIZE_TABLE = SIZE_VALUES.map((s, i) => ({ size: s, vcpu: SIZES[i].cpu, ramGb: SIZES[i].ram, costPerMonthUsd: SIZES[i].cost }));

/** Rules an LLM should follow; sent as the MCP server instructions and in list_component_kinds. */
export const DESIGN_GUIDE = `How to describe a SysLab design:
- Refer to components by their unique "name". Never send ids or x/y positions; SysLab lays the diagram out.
- Start with exactly one "users" component. Set "users" (peak concurrent users) or "dailyActiveUsers".
- Typical path: users → cdn (static/video) and users → lb or gateway → app services → cache → db.
- Caches work two ways: read-through (app → cache → db) or cache-aside (app → cache and app → db).
  Either way reads hit the cache first (90% hits); misses and all writes reach the db.
- Several app servers (replicas or horizontal autoscale) need a load balancer, gateway or queue in front.
- Use a queue + worker for slow or async work (emails, encoding, fan-out); mark those connections "async": true.
- For a db, set database.readReplicas for read-heavy loads and database.shards for write-heavy loads.
- Use groups for regions, VPCs or tiers, and flows for important request paths (Checkout, Login…).
- After create_design, read the simulation report: fix overloaded components (bigger size, more replicas,
  autoscale, a cache, read replicas, shards) and call update_design with the full corrected spec.`;
