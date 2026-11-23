# How the simulation works

SysLab's engine lives in [`packages/sim`](../packages/sim/src). It is pure TypeScript with no I/O, and
the web app, the shared viewer and the MCP server all run the same code. Every second it does two
things:

1. **`simulate(doc, runtime)`** works out the steady state for this second: how many requests each
   component gets, how full it is, what it drops, and the latency.
2. **`stepRuntime(...)`** moves time forward by one second: autoscalers react, queues fill or drain,
   cache contents warm up or expire, and retries and circuit breakers react to failures.

## 1. Traffic

- Traffic is `users × 0.06` requests/s (`RPS_PER_USER`). A spike multiplies it.
- **Load balancer**: splits by its algorithm (round robin, weighted, least connections, IP hash; see
  [`balancer.ts`](../packages/sim/src/balancer.ts)). The health check skips offline servers.
- **Any other caller**: by default its traffic is **split** across its connections by `weight`.
  A connection with **calls per request** (fan-out) gets `calls ×` every request instead. For
  example, an API that calls three services sets `1×` on each, so each service gets all of the
  API's traffic.
- **Cache-aside** (app → cache and app → db): reads go to the cache first. 90% hit
  (`CACHE_HIT`); misses and all writes go to the db. **Read-through** (app → cache → db) works the
  same way through the cache.
- **Queue**: consumers pull only what they can handle; the rest waits as backlog. Two delivery modes:
  - **Pub/Sub** (default for Kafka): every subscriber gets every message, like a Kafka consumer
    group per worker or SNS. Each subscriber keeps its own backlog (lag); a slow one falls behind
    alone and never fails the producer.
  - **Work queue** (default for SQS, RabbitMQ and others): each message goes to one consumer, so
    consumers share the load in proportion to their capacity.

## 2. Capacity

```
capacity per instance = kind baseline × machine vCPUs × technology multiplier
```

- Baselines are in [`catalog.ts`](../packages/sim/src/catalog.ts), for example app = 150 requests/s
  per vCPU and db = 120.
- Technology multipliers are in [`techs.ts`](../packages/sim/src/techs.ts), for example Go ×1.6,
  Python ×0.55 and Memcached ×1.3. They are rough numbers from public benchmarks.
- **Measured numbers win.** The inspector's *Performance* card (or `measured` in the MCP spec)
  takes requests/s per instance and ms per request from a real load test. The measured capacity
  scales with vCPUs if you change the machine size.

A component **drops** whatever is above its capacity. A replica behind an uneven split can drop
requests even when the others are idle.

## 3. Latency: queueing theory (Erlang C)

Each instance is modelled as an **M/M/c queue** ([`queueing.ts`](../packages/sim/src/queueing.ts)):

```
service time S  = kind latency × technology multiplier (or the measured ms)
workers c       = capacity × S            (Little's law: busy workers = rate × time)
utilisation ρ   = incoming / capacity
P(wait)         = Erlang C(c, ρ·c)
mean wait       = P(wait) × S / (c·(1 − ρ))
p-quantile wait = S / (c·(1 − ρ)) × ln(P(wait) / (1 − p))
```

This explains a lot of real behaviour:

- A big pool (an app with c ≈ 90 workers) barely queues at 85% load.
- A small one (c = 4) is already slow at 85%.
- Every server gets dramatically slower close to 100%.
- Past 100% the line only grows until requests hit the client timeout (`TIMEOUT_MS`, 1 s).

**Path latency.** The engine walks the synchronous calls bottom-up and takes the slowest path from
the users:

- Each node adds `S + mean wait`.
- Each hop inside the data center adds 0.5 ms.
- The user's internet round trip adds 20 ms.
- Sequential fan-out calls multiply the time: 3 calls take 3× as long.

**P95 / P99.** Means add up along the path. For each node, the spread above the mean (service-time
tail `S × 1.6` / `× 2.3` plus the queue's wait quantile) is treated as an independent variance:

```
P95 = mean + √(Σ spread95²)
```

When more than 2% of requests time out, those timeouts become the P95 (1 s and up).

## 4. Errors

The error rate is the share of **user requests** that fail, computed bottom-up:

```
fail(node) = 1 − (1 − dropped share) × (1 − fail of what it calls)
```

- **Fan-out** calls must all succeed: a request survives with the product of their success rates.
  Two services that each drop 50% give 75% errors, not 100%.
- **Split traffic** fails in proportion to the path each request took.
- **Retries**: a call retried `r` times fails only if every attempt fails (`fail^(r+1)`).
- **Open circuit breaker**: its calls fail instantly. They count as errors but not as timeouts,
  so they do not push P95 up.
- **Queues** buffer, so problems behind a queue do not fail the request (unless the queue is full).

## 5. Things that change over time (`stepRuntime`)

| What | Rule |
|---|---|
| Horizontal autoscaling | Adds or removes replicas towards the CPU target; a replica drains for 2 s before it is removed |
| Vertical autoscaling | Moves to the smallest machine that fits under the target |
| Queues | Depth changes by (in − out) every second, capped at 1M messages; a pub/sub queue tracks each subscriber's lag separately |
| Cache offline | Memory is lost; it comes back **cold** (hit rate 0%) and warms up 25% of the gap per second (stampede on the db) |
| DB behind a cache offline | Keys expire linearly over one **TTL**, so errors climb to 100% after one TTL |
| Retries | A caller with retries sends `1 + f + f² + …` attempts, where `f` is what the target dropped last second. On an overloaded target this feeds itself (a **retry storm**) |
| Circuit breaker | Trips when the target drops more than 50%, stays open 10 s (calls fail fast and the target rests), then tries again |

## 6. Connection limits

Postgres (100) and MySQL (151) cap client connections per server. Every app or worker instance
holds a pool of 10 (`POOL_PER_INSTANCE`, HikariCP's default), so 20 replicas need 200. Past the limit,
the extra connections are refused and that share of queries fails. To fix it:

- raise *Max connections*;
- put a pooler like PgBouncer in front (the 10k option);
- add read replicas (each server adds its own limit).

MongoDB, Cassandra and DynamoDB have no such small cap.

### Ring databases (Cassandra)

Cassandra has no primary: [`ring.ts`](../packages/sim/src/ring.ts) models it as a consistent-hash ring of
equal nodes. Every row lives on **RF** nodes (replication factor, default 3) and a request waits for
**k** of them, set by the consistency level: ONE = 1, QUORUM = ⌊RF/2⌋ + 1, ALL = RF.

| | Formula |
|---|---|
| Work per request | `read·k + write·RF` replica operations |
| Capacity | `(nodes − failed) × per-node capacity / work`, so more nodes add capacity and a higher RF costs it |
| Latency | ×1 ONE, ×1.15 QUORUM, ×1.4 ALL (waiting for the k-th fastest replica) + 0.5 ms coordinator hop |
| Failures tolerated | `RF − k` nodes, e.g. 1 for RF 3 at QUORUM |
| Rows unavailable | share of token ranges with more than `RF − k` replicas on failed nodes (hypergeometric); those requests fail |

On the canvas the nodes sit in a circle around the database (up to 12 drawn), with gossip lines between
them; failed nodes are grey. The *Ring cluster* card sets nodes, RF, consistency and failed nodes.

## 7. Cost (AWS list prices)

[`pricing.ts`](../packages/sim/src/pricing.ts) prices every component the way AWS bills it: us-east-1 on-demand list prices,
rounded. A real quote comes from the AWS Pricing Calculator; these are realistic orders of magnitude.

| Component | Billed as |
|---|---|
| App, worker | EC2 per instance: 2 vCPU c6i.large, 8 m6i.2xlarge, 16 m6i.4xlarge, 64 m6i.16xlarge, 192 m7i.48xlarge |
| Cache | ElastiCache node (×1.55 the EC2 price; Valkey ×1.24) |
| Database | RDS (Postgres, MySQL ×1.78), DocumentDB (MongoDB ×1.8) or self-managed EC2, per shard × (1 + replicas) (every ring node for Cassandra), plus storage; DynamoDB per million reads / writes |
| Object storage | S3 GB-month + GET / PUT requests |
| CDN | CloudFront GB out (tiered) + HTTPS requests |
| Load balancer | ALB hour + LCUs, or an Nginx / HAProxy pair on EC2 |
| API gateway | API Gateway per million requests, or self-hosted on EC2 |
| Queue | MSK brokers (Kafka), SQS requests, ElastiCache (BullMQ) or a self-hosted cluster |
| External APIs | SES per email, SMS per message; payments are billed on revenue |
| Internet egress | Responses served by the origin (not the CDN), tiered per GB |

Usage-based prices follow the live traffic and three sizes in the requirements (API reply KB, CDN file KB,
GB per database server). The Metrics tab lists the biggest line items and standard ways to save:
Spot for queue workers, Savings Plans and reserved databases, Graviton, and one size smaller for
machines with traffic but under 25% busy. Each is estimated on its own; they overlap.

## 8. Over time (Metrics tab)

The editor records one sample per second while the simulation runs (the last 5 minutes). It tracks
throughput (answered vs. offered), P95 / P99 against the SLO, errors, running instances, queue backlog
and cost, with ticks for autoscaling events, plus each component's load and latency. `simulate_design`
returns the same as a `timeline` (one point every 5 seconds) together with a `cost` breakdown.

## Tests

```powershell
pnpm test
```

- [`behavior.test.ts`](../packages/sim/test/behavior.test.ts) checks traffic, caches, load
  balancers, autoscaling and queues.
- [`physics.test.ts`](../packages/sim/test/physics.test.ts) checks Erlang C against textbook values,
  plus technologies, measured numbers, fan-out, connections, retries and breakers.
- [`golden.test.ts`](../packages/sim/test/golden.test.ts) locks the numbers of every template at
  0.5× / 1× / 3× traffic. When a physics change is intended, regenerate them:
  `UPDATE_GOLDEN=1 pnpm vitest run --project sim`, and review the diff of `golden.json`.

## Limits (what is still simplified)

- Steady state per second, not single requests: bursts shorter than a second are averaged out.
- Service times use a fixed tail shape; real servers can have heavier tails (GC pauses, disk).
- Memory, network bandwidth, disk IOPS and storage growth are not modelled yet.
- Prices are AWS us-east-1 list prices only (no other clouds or regions yet, no free tiers except egress).
