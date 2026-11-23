# SysLab MCP server

Any AI app that speaks the **Model Context Protocol** (Claude Code, Claude Desktop, Cursor, VS Code,
Gemini CLI, ChatGPT connectors…) can design, build and load-test systems in SysLab:

> "Design Instagram's feed in SysLab and test it with a 3× spike."

The model calls SysLab's tools, SysLab lays the diagram out and simulates it, and the model replies
with a link that opens the design in the editor.

- Endpoint: `POST <api>/api/mcp` (for example `https://syslab-api.onrender.com/api/mcp`)
- Protocol: MCP **2026-07-28** (stateless, one POST per message) plus 2025-era clients
- SDK: `@modelcontextprotocol/server` v2 + `@modelcontextprotocol/node`

## Tools

| Tool | What it does |
|---|---|
| `list_component_kinds` | Catalog: component kinds, capacities, sizes and costs, and the rules for writing a spec |
| `create_design` | New design from a spec → id, link, warnings, simulation report |
| `update_design` | Replace a design with a corrected full spec (same id and link) |
| `get_design` | Read a design back as a spec, including edits made in the editor |
| `simulate_design` | Load-test a saved design with optional `users` / `spike` / `seconds` |
| `list_designs` | Recent designs with ids and links |

Prompt: `design_system(product)` gives the model a step-by-step brief (build → read report → fix → spike test).

## The design spec

Components are referenced **by name**. There are no ids and no coordinates; SysLab assigns ids and lays
everything out (users on the left, then edge, services, data; every group gets its own band, so
group boxes never cover unrelated components).

```json
{
  "name": "Instagram feed",
  "dailyActiveUsers": 20000000,
  "components": [
    { "name": "Users", "kind": "users" },
    { "name": "LB", "kind": "lb", "loadBalancer": { "algorithm": "least_connections" } },
    { "name": "Feed Service", "kind": "app", "size": "64vCPU", "autoscale": { "min": 2, "max": 10 } },
    { "name": "Redis", "kind": "cache" },
    { "name": "Posts DB", "kind": "db", "database": { "shards": 2, "readReplicas": 2 } }
  ],
  "connections": [
    { "from": "Users", "to": "LB" },
    { "from": "LB", "to": "Feed Service" },
    { "from": "Feed Service", "to": "Redis" },
    { "from": "Redis", "to": "Posts DB", "carries": "read" }
  ],
  "groups": [{ "name": "AWS us-east-1", "members": ["LB", "Feed Service", "Redis"] }],
  "flows": [{ "name": "Open feed", "steps": ["Users", "LB", "Feed Service", "Redis", "Posts DB"] }]
}
```

Realism fields (all optional):

| Field | Where | Meaning |
|---|---|---|
| `tech` | component | Known technologies change capacity and latency (Go ×1.6, Python ×0.55, Postgres caps connections at 100…) |
| `measured: { requestsPerSecond, latencyMs }` | component | Numbers from a real load test; they replace the estimates |
| `database.maxConnections` | db | Client connections per server (10000 ≈ a pooler like PgBouncer) |
| `database.nodes`, `replicationFactor`, `consistency`, `failedNodes` | db (Cassandra) | Ring of 3–24 equal nodes; copies of every row (default 3); replicas a request waits for (`one` / `quorum` / `all`); nodes down to rehearse an outage |
| `cache.ttlSeconds` | cache | How long keys live if the database behind it goes down |
| `queue.mode` | queue | `pubsub` (every subscriber gets every message; Kafka default) or `work` (workers share messages) |
| `avgResponseKb`, `avgFileKb`, `storageGb` | design | Sizes that drive the cost: API reply size, CDN file size, data per database server |
| `callsPerRequest` | connection | Fan-out: every request makes this many calls here (instead of splitting traffic) |
| `retries`, `circuitBreaker` | connection | Failure handling; retries can cause retry storms |

`simulate_design` reports a `timeline` (one point every 5 s), a `cost` breakdown at AWS list prices with ways to save, mean / P95 / P99 latency, per-component load and latency, and issues such as
connection limits, retry storms and open breakers. How the numbers are computed: [simulation.md](simulation.md).

Kinds: `users, cdn, lb, gateway, app, worker, cache, db, store, queue, ext`. The full schema with a
description of every field is in [`packages/spec/src/schema.ts`](../packages/spec/src/schema.ts).
Mistakes come back as readable errors (`No component named "Feed Servce". Did you mean "Feed Service"?`)
so the model can fix them and retry.

The same spec also works without MCP: `POST /api/designs/import` with `{ "spec": … }`.

## How the code fits together

```
LLM app ──POST /api/mcp──▶ McpController ──▶ McpService (createMcpHandler + toNodeHandler)
                                                   │ a fresh McpServer per request
                                                   ▼
                                              mcp.server.ts (tools)
                                                   │
                          @syslab/spec: buildDesign → layout, docToSpec, simulationReport
                                                   │
                          DesignsService.createFromDoc / replaceFromSpec ──▶ Postgres
```

| File | Role |
|---|---|
| `packages/spec/src/schema.ts` | zod schema of the spec. The descriptions are what the model reads |
| `packages/spec/src/build.ts` | spec → editor document: name checks with "did you mean", settings mapping, warnings |
| `packages/spec/src/layout.ts` | auto-layout: longest-path columns, group bands, room for replicas / shards / pills |
| `packages/spec/src/readback.ts` | editor document → spec (for `get_design`) |
| `packages/spec/src/report.ts` | runs the simulator (letting autoscalers and queues settle) and writes the report |
| `packages/spec/src/catalog.ts` | component catalog, size table and the design guide sent to models |
| `apps/api/src/mcp/mcp.server.ts` | registers the tools and the prompt on an `McpServer` |
| `apps/api/src/mcp/mcp.service.ts` | builds the HTTP handler once, checks the optional API key |
| `apps/api/src/mcp/mcp.controller.ts` | `ALL /api/mcp`, hands Express's parsed body to the handler |
| `apps/api/src/designs/designs.service.ts` | `createFromDoc`, `replaceFromSpec`, `importSpec` |

## Security

There is no user login yet. Every MCP call acts as the single dev user, the same as the web app.
Set **`MCP_API_KEY`** on the API to require `Authorization: Bearer <key>` on `/api/mcp`. The Render
blueprint generates one automatically. Without a key, anyone who knows the URL can create and
overwrite designs.

## Manual steps

### Local
1. `pnpm install`, then `pnpm dev` as usual. The endpoint is `http://localhost:4000/api/mcp`.
2. Try it with the MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP",
   URL `http://localhost:4000/api/mcp`.

### Render (production)
1. After this is merged to `main`, Render redeploys. If the Blueprint does not add the new variables by
   itself, open **syslab-api → Environment** and add:
   - `WEB_URL` = your web URL, for example `https://syslab-web.onrender.com`
   - `MCP_API_KEY` = a long random string
2. Copy `MCP_API_KEY` from **syslab-api → Environment**. This is what you give your AI app.
3. Free Render services sleep after 15 idle minutes; the first MCP call can take ~30–50 s and some apps
   time out. A paid instance avoids that.

### Connecting AI apps
Replace `<api>` with your API URL and `<key>` with `MCP_API_KEY`. Each app's config format can change;
check its MCP docs if a field name differs.

- **Claude Code:**
  `claude mcp add --transport http syslab <api>/api/mcp --header "Authorization: Bearer <key>"`
- **Cursor** (`~/.cursor/mcp.json`):
  `{ "mcpServers": { "syslab": { "url": "<api>/api/mcp", "headers": { "Authorization": "Bearer <key>" } } } }`
- **VS Code** (`.vscode/mcp.json`):
  `{ "servers": { "syslab": { "type": "http", "url": "<api>/api/mcp", "headers": { "Authorization": "Bearer <key>" } } } }`
- **Gemini CLI** (`~/.gemini/settings.json`):
  `{ "mcpServers": { "syslab": { "httpUrl": "<api>/api/mcp", "headers": { "Authorization": "Bearer <key>" } } } }`
- **Claude.ai / ChatGPT custom connectors** sign in with OAuth and cannot send a fixed header. They will work
  once login (OAuth) is added, or with `MCP_API_KEY` unset (not recommended on a public URL).

Then ask: *"Use SysLab to design Uber's ride matching and test it with a 5× spike."*
