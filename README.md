# SysLab

Interactive system-design lab: drag in components, wire them up, simulate traffic,
watch autoscaling, replication and request flows animate on an isometric canvas.

```
apps/
  web/        Next.js 16 (App Router) + React 19 + Zustand + TanStack Query
  api/        NestJS 11 + Prisma 7 + PostgreSQL
packages/
  types/      Domain types and API contracts shared by web and api
  sim/        Pure simulation engine: catalog, templates, simulate(), autoscaler, layout
```

## Run it

Requirements: Node 22+, pnpm 10, Docker (or any Postgres 14+).

```bash
pnpm install
pnpm db:up                                   # Postgres on :5432 (docker compose)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @syslab/api prisma:deploy      # apply migrations
pnpm db:seed                                 # dev user + 2 sample designs
pnpm dev                                     # api :4000, web :3000
```

Open http://localhost:3000.

Auth is a seam for now: `DevAuthGuard` makes every request act as `DEV_USER_EMAIL`.
Swap it for a JWT guard in `app.module.ts`; controllers already read `@CurrentUser()`.

## Deploy (Render + Neon)

The repo ships a Render Blueprint (`render.yaml`) for the API and the web app; Postgres lives on Neon.

1. **Neon:** create a project (region *AWS Asia Pacific (Singapore)* to sit next to Render), and copy the
   **direct** connection string (the host without `-pooler`), e.g. `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
2. **Render:** *New → Blueprint →* this repository → paste the Neon string when asked for `DATABASE_URL` → *Apply*.
3. Migrations run automatically when the API starts. The dev user is created on the first request.
4. If Render renamed a service because the name was taken, set `NEXT_PUBLIC_API_URL` (web) and
   `CORS_ORIGIN` (api) to the real `*.onrender.com` URLs and redeploy.

Free Render services sleep after 15 idle minutes, so the first request after a pause is slow.
There is no real login yet: everyone who opens the site acts as the same dev user.

## Use SysLab from any AI (MCP)

SysLab exposes a Model Context Protocol server at `/api/mcp`, so Claude, Cursor, VS Code, Gemini CLI and
other MCP apps can create, read and load-test designs from a name-based spec. Setup, tools and the spec
format: [docs/mcp.md](docs/mcp.md).

## Architecture rules

### Frontend (`apps/web/src`)

| Layer | Folder | Rule |
|---|---|---|
| API | `lib/api/*.api.ts` | Only network calls. One `http.ts` wrapper, typed by `@syslab/types`. |
| Logic | `hooks/**` | All state, derived data and side effects. Hooks call the API layer and return **view models + callbacks**. |
| Pure helpers | `lib/canvas`, `@syslab/sim` | Deterministic functions (simulation, layout, view-model builders). No React. |
| UI | `components/**` | Render props only. No fetching, no store access, no business logic. |
| Page | `app/**/page.tsx` | Wires hooks to components. Nothing else. |

- **Editor state** lives in one Zustand + Immer store (`hooks/editor/editor.store.ts`).
  Every document edit goes through `editDoc`, which bumps `editSeq` for autosave.
- **Autosave** (`useAutosave`) is debounced, single-flight, and uses optimistic
  concurrency (`revision`); a 409 stops saving and asks for a reload.
- **One clock** (`useEngineTicker`) drives autoscaling, flow playback and toast expiry.
  It reads the store imperatively, so it never re-renders anything by itself.
- **Rendering cost**: `simulate()` and `buildCanvasView()` are memoised on `doc` and
  `runtime`; drag updates are batched per animation frame; canvas components are `memo`.
- **Reuse**: buttons, option groups, steppers, fields, cards, tabs, modal, toast live
  in `components/ui`. All isometric shapes come from one `IsoShape` component.

### Backend (`apps/api/src`)

```
Controller  ->  Service  ->  Repository  ->  Prisma
(HTTP, DTO)     (rules)      (only DB calls)
```

- Repositories are the only classes that touch `PrismaService`; every query is scoped by owner.
- A design's graph is one `JSONB` column (`doc`). The editor always loads and saves it
  whole, so one read / one write beats normalised node and edge tables.
- List pages read a small denormalised `summary` column, never the doc.
- `revision` gives compare-and-set updates (`updateMany where revision = n`).
- DTOs are validated by `class-validator`; Prisma errors map to 404/409 in a global filter.

### API

| Method | Path | |
|---|---|---|
| GET | `/api/designs?limit&cursor` | list (summaries) |
| POST | `/api/designs` | create from template `{ template, name? }` |
| GET | `/api/designs/:id` | full design |
| PATCH | `/api/designs/:id` | `{ name?, doc?, revision }` → `{ revision }` or 409 |
| POST | `/api/designs/:id/duplicate` | |
| PATCH | `/api/designs/:id/share` | `{ enabled }` |
| DELETE | `/api/designs/:id` | |
| GET/POST | `/api/designs/:id/versions` | list / snapshot |
| POST | `/api/designs/:id/versions/:vid/restore` | |
| GET | `/api/public/designs/:token` | shared, read-only |
| GET | `/api/health` | |

## Adding a component type

1. Add the kind to `NodeKind` in `packages/types`.
2. Add its spec, techs and icon in `packages/sim/src/catalog.ts` (and a palette group).
3. If it needs a new silhouette, add a case to `components/iso/IsoShape.tsx`.

The simulation, inspector and palette pick it up automatically.
