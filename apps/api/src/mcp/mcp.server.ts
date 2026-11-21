import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  DESIGN_GUIDE, DesignSpec, SIZE_TABLE, SpecError, buildDesign, componentCatalog, docToSpec, simulationReport,
} from '@syslab/spec';
import type { DesignsService } from '../designs/designs.service';

export interface McpDeps {
  designs: DesignsService;
  /** who the tools act for (the dev user until real auth lands) */
  userId: string;
  /** public web URL, for "open in SysLab" links */
  webUrl: string;
}

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ content: [{ type: 'text', text }], ...(data && { structuredContent: data }) });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

/** Turn spec / not-found errors into a tool error the model can read and fix; rethrow anything else. */
function asToolError(e: unknown): ToolResult {
  if (e instanceof SpecError) return fail(`${e.message}\n\nFix these and call the tool again with the full corrected spec.`);
  const status = (e as { status?: number })?.status;
  if (status === 404) return fail('No design with that id. Call list_designs to see the ids you can use.');
  if (status === 400) return fail(`SysLab rejected the design: ${(e as Error).message}`);
  throw e;
}

const designId = z.string().trim().min(1).max(64).describe('Design id from create_design or list_designs');

/**
 * One MCP server instance with SysLab's tools. createMcpHandler builds a fresh one per HTTP
 * request (the protocol is stateless), so this function must be cheap and side-effect free.
 */
export function buildMcpServer({ designs, userId, webUrl }: McpDeps): McpServer {
  const link = (id: string) => `${webUrl}/designs/${id}`;
  const server = new McpServer(
    { name: 'syslab', version: '0.1.0' },
    {
      instructions: `SysLab draws and load-tests system designs (HLDs). Describe a design as a spec with create_design; `
        + `SysLab lays it out, simulates traffic, and returns a link the user can open. Iterate with update_design.\n\n${DESIGN_GUIDE}`,
    },
  );

  server.registerTool('list_component_kinds', {
    title: 'List SysLab component kinds',
    description: 'What each component kind is, how much traffic it handles, machine sizes and costs, and the rules for writing a design spec. Call this first if unsure.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const data = { guide: DESIGN_GUIDE, kinds: componentCatalog(), sizes: SIZE_TABLE };
    return ok(JSON.stringify(data, null, 2), data);
  });

  server.registerTool('create_design', {
    title: 'Create a SysLab design',
    description: 'Create a new system design from a spec (components, connections, groups, flows, notes). '
      + 'Returns the design id, a link to open it in SysLab, warnings, and a traffic simulation report.',
    inputSchema: z.object({ spec: DesignSpec }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ spec }) => {
    try {
      const built = buildDesign(spec);
      const design = await designs.createFromDoc(userId, built.name, built.doc);
      const report = simulationReport(built.doc);
      const text = [
        `Created "${design.name}" (id ${design.id}).`,
        `Open it in SysLab: ${link(design.id)}`,
        ...(built.warnings.length ? ['', 'Warnings:', ...built.warnings.map((w) => `- ${w}`)] : []),
        '', 'Simulation:', report.text,
      ].join('\n');
      const { text: _t, ...simulation } = report;
      return ok(text, { id: design.id, url: link(design.id), warnings: built.warnings, simulation });
    } catch (e) { return asToolError(e); }
  });

  server.registerTool('update_design', {
    title: 'Replace a SysLab design',
    description: 'Replace an existing design with a corrected full spec (same id and link). '
      + 'Typical loop: get_design → change the spec → update_design. Returns warnings and a fresh simulation report.',
    inputSchema: z.object({ designId, spec: DesignSpec }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ designId: id, spec }) => {
    try {
      const built = buildDesign(spec);
      const design = await designs.replaceFromSpec(userId, id, built.name, built.doc);
      const report = simulationReport(built.doc);
      const text = [
        `Updated "${design.name}" (id ${design.id}). Open: ${link(design.id)}`,
        ...(built.warnings.length ? ['', 'Warnings:', ...built.warnings.map((w) => `- ${w}`)] : []),
        '', 'Simulation:', report.text,
      ].join('\n');
      const { text: _t, ...simulation } = report;
      return ok(text, { id: design.id, url: link(design.id), warnings: built.warnings, simulation });
    } catch (e) { return asToolError(e); }
  });

  server.registerTool('get_design', {
    title: 'Read a SysLab design',
    description: 'Return a design as a spec (the same format create_design takes), including edits the user made in the editor.',
    inputSchema: z.object({ designId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ designId: id }) => {
    try {
      const d = await designs.get(userId, id);
      const spec = docToSpec(d.name, d.doc);
      return ok(`Design "${d.name}" (${link(d.id)}):\n${JSON.stringify(spec, null, 2)}`, { id: d.id, url: link(d.id), spec });
    } catch (e) { return asToolError(e); }
  });

  server.registerTool('simulate_design', {
    title: 'Load-test a SysLab design',
    description: 'Simulate traffic on a saved design without changing it: optionally override concurrent users or apply a spike multiplier. '
      + 'Reports P95 latency vs target, errors, cost, overloaded components, autoscaling, queues and load balancer splits.',
    inputSchema: z.object({
      designId,
      users: z.number().int().min(0).max(100_000_000).optional().describe('Override peak concurrent users'),
      spike: z.number().min(1).max(100).optional().describe('Traffic multiplier, e.g. 2, 10, 50'),
      seconds: z.number().int().min(0).max(300).optional().describe('How long autoscalers and queues get to react (default 60)'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ designId: id, users, spike, seconds }) => {
    try {
      const d = await designs.get(userId, id);
      const report = simulationReport(d.doc, { users, spike, seconds });
      const { text, ...data } = report;
      return ok(`Simulation of "${d.name}" (${link(d.id)}):\n${text}`, data);
    } catch (e) { return asToolError(e); }
  });

  server.registerTool('list_designs', {
    title: 'List SysLab designs',
    description: 'The most recently updated designs with their ids and links.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ limit }) => {
    const { items } = await designs.list(userId, limit ?? 20);
    const rows = items.map((d) => ({ id: d.id, name: d.name, url: link(d.id), updatedAt: d.updatedAt }));
    return ok(rows.length ? rows.map((r) => `- ${r.name} (id ${r.id}) ${r.url}`).join('\n') : 'No designs yet.', { designs: rows });
  });

  server.registerPrompt('design_system', {
    title: 'Design a system in SysLab',
    description: 'Ask the model to design, build and load-test a system in SysLab.',
    argsSchema: z.object({ product: z.string().describe('What to design, e.g. "Instagram feed" or "Uber ride matching"') }),
  }, ({ product }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Design a production-grade high-level architecture for: ${product}.\n`
          + '1. Call list_component_kinds if you need the catalog.\n'
          + '2. Call create_design with a complete spec: one users component with a realistic user count, edge (CDN/LB/gateway), services, caches, databases, queues and workers, groups for regions/tiers, and flows for the 2–4 most important requests.\n'
          + '3. Read the simulation report. If anything is overloaded or P95 misses the target, fix it and call update_design.\n'
          + '4. Run simulate_design with spike 3 and explain what breaks first and why.\n'
          + '5. Finish with the SysLab link and a short explanation of the design choices.',
      },
    }],
  }));

  return server;
}
