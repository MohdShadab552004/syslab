import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { buildDesign, docToSpec, DESIGN_GUIDE, SIZE_TABLE, componentCatalog } from '@syslab/spec';
import { McpService } from '../src/mcp/mcp.service';
import { McpController } from '../src/mcp/mcp.controller';

/* A small but complete spec: users -> lb -> app -> db (+ a duplicate connection for a warning). */
const SPEC = {
  name: 'Shop',
  users: 500,
  components: [
    { name: 'Users', kind: 'users' },
    { name: 'LB', kind: 'lb' },
    { name: 'API', kind: 'app', replicas: 2 },
    { name: 'DB', kind: 'db' },
  ],
  connections: [
    { from: 'Users', to: 'LB' }, { from: 'LB', to: 'API' }, { from: 'API', to: 'DB' },
  ],
};
const SPEC_WITH_WARNING = { ...SPEC, connections: [...SPEC.connections, { from: 'API', to: 'DB' }] };
const built = buildDesign(SPEC);

const design = (over: Record<string, unknown> = {}) => ({
  id: 'd1', name: 'Shop', doc: built.doc, revision: 1, shareEnabled: false, shareToken: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...over,
});

const designs = {
  createFromDoc: vi.fn(),
  replaceFromSpec: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
};

type Rpc = { result?: Record<string, any>; error?: { code: number; message: string } };

/** Mirrors what McpController does after auth: attach authInfo and hand over the parsed body. */
let server: http.Server;
let base = '';
let userIdForRequests: string | undefined = 'u1';
let service: McpService;

function startServer(svc: McpService) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (userIdForRequests !== undefined) {
        (req as any).auth = { token: 'dev', clientId: userIdForRequests, scopes: [], extra: { userId: userIdForRequests } };
      }
      void svc.handle(req as any, res, body ? JSON.parse(body) : undefined);
    });
  });
}

let nextId = 1;
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Rpc> {
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const text = await r.text();
  if ((r.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    return data[data.length - 1];
  }
  return JSON.parse(text);
}
const call = (name: string, args: Record<string, unknown> = {}) => rpc('tools/call', { name, arguments: args });
const textOf = (r: Rpc) => (r.result!.content as { text: string }[]).map((c) => c.text).join('\n');

beforeAll(async () => {
  const config = { get: vi.fn((k: string) => (k === 'webUrl' ? 'http://web.test' : null)) };
  service = new McpService(designs as never, config as never);
  server = startServer(service);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  vi.clearAllMocks();
  userIdForRequests = 'u1';
});

describe('MCP protocol surface', () => {
  test('initialize advertises tools, prompts and the design guide', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(r.result!.serverInfo).toEqual({ name: 'syslab', version: '0.1.0' });
    expect(r.result!.capabilities).toMatchObject({ tools: {}, prompts: {} });
    expect(r.result!.instructions).toContain('SysLab draws and load-tests system designs');
    expect(r.result!.instructions).toContain(DESIGN_GUIDE);
  });

  test('tools/list lists all six tools with annotations', async () => {
    const r = await rpc('tools/list');
    const tools = r.result!.tools as { name: string; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name)).toEqual(['list_component_kinds', 'create_design', 'update_design', 'get_design', 'simulate_design', 'list_designs']);
    expect(tools.find((t) => t.name === 'update_design')!.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(tools.find((t) => t.name === 'get_design')!.annotations).toMatchObject({ readOnlyHint: true });
  });

  test('prompts/list and prompts/get design_system', async () => {
    const list = await rpc('prompts/list');
    expect(list.result!.prompts.map((p: { name: string }) => p.name)).toEqual(['design_system']);
    const r = await rpc('prompts/get', { name: 'design_system', arguments: { product: 'Uber ride matching' } });
    const [msg] = r.result!.messages;
    expect(msg.role).toBe('user');
    expect(msg.content.type).toBe('text');
    expect(msg.content.text).toMatch(/^Design a production-grade high-level architecture for: Uber ride matching\./);
    expect(msg.content.text).toContain('Call create_design');
    expect(msg.content.text).toContain('simulate_design with spike 3');
  });
});

describe('list_component_kinds', () => {
  test('returns the guide, catalog and sizes as text and structured data', async () => {
    const r = await call('list_component_kinds');
    const data = { guide: DESIGN_GUIDE, kinds: componentCatalog(), sizes: SIZE_TABLE };
    expect(r.result!.structuredContent).toEqual(JSON.parse(JSON.stringify(data)));
    expect(JSON.parse(textOf(r))).toEqual(JSON.parse(JSON.stringify(data)));
  });
});

describe('create_design', () => {
  test('saves the built doc for the authenticated user and reports a link and simulation', async () => {
    designs.createFromDoc.mockResolvedValue(design({ id: 'new1', name: 'Shop' }));
    const r = await call('create_design', { spec: SPEC });
    expect(r.result!.isError).toBeFalsy();
    expect(designs.createFromDoc).toHaveBeenCalledWith('u1', 'Shop', expect.objectContaining({ schemaVersion: 1 }));
    const text = textOf(r);
    expect(text).toContain('Created "Shop" (id new1).');
    expect(text).toContain('Open it in SysLab: http://web.test/designs/new1');
    expect(text).toContain('Simulation:');
    expect(text).not.toContain('Warnings:');
    const sc = r.result!.structuredContent;
    expect(sc).toMatchObject({ id: 'new1', url: 'http://web.test/designs/new1', warnings: [] });
    expect(sc.simulation).toBeTypeOf('object');
    expect(sc.simulation.text).toBeUndefined();
  });

  test('lists build warnings', async () => {
    designs.createFromDoc.mockResolvedValue(design({ id: 'new2' }));
    const r = await call('create_design', { spec: SPEC_WITH_WARNING });
    expect(textOf(r)).toContain('Warnings:\n- Duplicate connection API → DB was ignored.');
    expect(r.result!.structuredContent.warnings).toEqual(['Duplicate connection API → DB was ignored.']);
  });

  test('spec problems come back as a readable tool error', async () => {
    const r = await call('create_design', { spec: { ...SPEC, connections: [{ from: 'Users', to: 'Nope' }] } });
    expect(r.result!.isError).toBe(true);
    expect(textOf(r)).toContain('No component named "Nope"');
    expect(textOf(r)).toContain('Fix these and call the tool again with the full corrected spec.');
    expect(designs.createFromDoc).not.toHaveBeenCalled();
  });

  test('a schema-invalid spec is rejected by input validation', async () => {
    const r = await call('create_design', { spec: { name: 'x', components: [] } });
    expect(r.error ?? r.result!.isError).toBeTruthy();
    expect(designs.createFromDoc).not.toHaveBeenCalled();
  });

  test('a 400 from SysLab is reported to the model', async () => {
    designs.createFromDoc.mockRejectedValue(new BadRequestException('Too many nodes (max 400)'));
    const r = await call('create_design', { spec: SPEC });
    expect(r.result!.isError).toBe(true);
    expect(textOf(r)).toBe('SysLab rejected the design: Too many nodes (max 400)');
  });

  test('an unexpected error is not turned into a friendly message', async () => {
    designs.createFromDoc.mockRejectedValue(new Error('database exploded'));
    const r = await call('create_design', { spec: SPEC });
    // asToolError rethrows; the SDK reports it as a failed call either way
    if (r.error) expect(r.error.message).toContain('database exploded');
    else {
      expect(r.result!.isError).toBe(true);
      expect(textOf(r)).toContain('database exploded');
      expect(textOf(r)).not.toContain('SysLab rejected');
    }
  });
});

describe('update_design', () => {
  test('replaces the design and reports a link and simulation', async () => {
    designs.replaceFromSpec.mockResolvedValue(design({ id: 'd7', name: 'Shop' }));
    const r = await call('update_design', { designId: '  d7  ', spec: SPEC });
    expect(designs.replaceFromSpec).toHaveBeenCalledWith('u1', 'd7', 'Shop', expect.objectContaining({ schemaVersion: 1 }));
    const text = textOf(r);
    expect(text).toContain('Updated "Shop" (id d7). Open: http://web.test/designs/d7');
    expect(text).not.toContain('Warnings:');
    expect(r.result!.structuredContent).toMatchObject({ id: 'd7', url: 'http://web.test/designs/d7', warnings: [] });
  });

  test('includes warnings', async () => {
    designs.replaceFromSpec.mockResolvedValue(design({ id: 'd7' }));
    const r = await call('update_design', { designId: 'd7', spec: SPEC_WITH_WARNING });
    expect(textOf(r)).toContain('Warnings:\n- Duplicate connection API → DB was ignored.');
  });

  test('unknown id -> tool error pointing at list_designs', async () => {
    designs.replaceFromSpec.mockRejectedValue(new NotFoundException('Design not found'));
    const r = await call('update_design', { designId: 'missing', spec: SPEC });
    expect(r.result!.isError).toBe(true);
    expect(textOf(r)).toBe('No design with that id. Call list_designs to see the ids you can use.');
  });

  test('spec errors', async () => {
    const r = await call('update_design', { designId: 'd7', spec: { ...SPEC, components: [...SPEC.components, { name: 'API', kind: 'app' }] } });
    expect(r.result!.isError).toBe(true);
    expect(textOf(r)).toContain('is used twice');
    expect(designs.replaceFromSpec).not.toHaveBeenCalled();
  });

  test('blank design id fails input validation', async () => {
    const r = await call('update_design', { designId: '   ', spec: SPEC });
    expect(r.error ?? r.result!.isError).toBeTruthy();
    expect(designs.replaceFromSpec).not.toHaveBeenCalled();
  });
});

describe('get_design', () => {
  test('returns the design as a spec', async () => {
    designs.get.mockResolvedValue(design({ id: 'd1', name: 'Shop' }));
    const r = await call('get_design', { designId: 'd1' });
    expect(designs.get).toHaveBeenCalledWith('u1', 'd1');
    const spec = docToSpec('Shop', built.doc);
    expect(r.result!.structuredContent).toEqual({ id: 'd1', url: 'http://web.test/designs/d1', spec: JSON.parse(JSON.stringify(spec)) });
    expect(textOf(r)).toBe(`Design "Shop" (http://web.test/designs/d1):\n${JSON.stringify(spec, null, 2)}`);
  });

  test('404 -> tool error', async () => {
    designs.get.mockRejectedValue(new NotFoundException());
    const r = await call('get_design', { designId: 'zzz' });
    expect(r.result!.isError).toBe(true);
    expect(textOf(r)).toContain('No design with that id');
  });
});

describe('simulate_design', () => {
  test('simulates with overrides', async () => {
    designs.get.mockResolvedValue(design());
    const base = await call('simulate_design', { designId: 'd1' });
    expect(textOf(base)).toMatch(/^Simulation of "Shop" \(http:\/\/web\.test\/designs\/d1\):\n/);
    expect(base.result!.structuredContent).toBeTypeOf('object');
    expect(base.result!.structuredContent.text).toBeUndefined();
    const spiked = await call('simulate_design', { designId: 'd1', users: 100000, spike: 10, seconds: 0 });
    expect(spiked.result!.isError).toBeFalsy();
    expect(textOf(spiked)).not.toBe(textOf(base));
  });

  test('out-of-range spike fails validation', async () => {
    const r = await call('simulate_design', { designId: 'd1', spike: 0.5 });
    expect(r.error ?? r.result!.isError).toBeTruthy();
    expect(designs.get).not.toHaveBeenCalled();
  });

  test('404 -> tool error', async () => {
    designs.get.mockRejectedValue(new NotFoundException());
    const r = await call('simulate_design', { designId: 'gone' });
    expect(r.result!.isError).toBe(true);
    expect(textOf(r)).toContain('No design with that id');
  });
});

describe('list_designs', () => {
  test('defaults to 20 and formats rows with links', async () => {
    designs.list.mockResolvedValue({ items: [{ id: 'a', name: 'Alpha', updatedAt: '2026-01-01T00:00:00.000Z' }, { id: 'b', name: 'Beta', updatedAt: '2026-01-02T00:00:00.000Z' }], nextCursor: null });
    const r = await call('list_designs');
    expect(designs.list).toHaveBeenCalledWith('u1', 20);
    expect(textOf(r)).toBe('- Alpha (id a) http://web.test/designs/a\n- Beta (id b) http://web.test/designs/b');
    expect(r.result!.structuredContent.designs).toEqual([
      { id: 'a', name: 'Alpha', url: 'http://web.test/designs/a', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'Beta', url: 'http://web.test/designs/b', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  test('honours limit and says so when empty', async () => {
    designs.list.mockResolvedValue({ items: [], nextCursor: null });
    const r = await call('list_designs', { limit: 5 });
    expect(designs.list).toHaveBeenCalledWith('u1', 5);
    expect(textOf(r)).toBe('No designs yet.');
    expect(r.result!.structuredContent).toEqual({ designs: [] });
  });

  test('without authInfo the tools act for an empty user id', async () => {
    userIdForRequests = undefined;
    designs.list.mockResolvedValue({ items: [], nextCursor: null });
    await call('list_designs');
    expect(designs.list).toHaveBeenCalledWith('', 20);
  });
});

describe('McpService error hooks', () => {
  test('rejected protocol messages are logged as warnings', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"nope":1}' });
    expect(r.status).toBe(400);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid JSON-RPC message'));
    warn.mockRestore();
  });

  test('adapter failures are logged as errors and answered with a 500', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const res = Object.assign(new EventEmitter(), { destroyed: false, writeHead: vi.fn(), end: vi.fn(), write: vi.fn(() => true) });
    // a header value Node would never produce makes request conversion throw
    const req = { method: 'POST', url: '/mcp', headers: { host: 'x', 'x-bad': 'a\nb' } };
    await service.handle(req as never, res as never, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.anything());
    error.mockRestore();
  });
});

describe('McpService.isAuthorized', () => {
  const make = (key: string | null) => new McpService(designs as never, { get: (k: string) => (k === 'mcpApiKey' ? key : 'http://w') } as never);

  test('open when no key is configured', () => {
    expect(make(null).isAuthorized(undefined)).toBe(true);
    expect(make('').isAuthorized('Bearer whatever')).toBe(true);
  });

  test('requires the exact bearer key when configured', () => {
    const svc = make('s3cret');
    expect(svc.isAuthorized('Bearer s3cret')).toBe(true);
    expect(svc.isAuthorized(undefined)).toBe(false);
    expect(svc.isAuthorized('')).toBe(false);
    expect(svc.isAuthorized('Bearer s3creT')).toBe(false); // same length, different bytes
    expect(svc.isAuthorized('Bearer s3cret ')).toBe(false); // different length
    expect(svc.isAuthorized('s3cret')).toBe(false);
  });
});

describe('McpController', () => {
  const fakeRes = () => {
    const res: Record<string, any> = {};
    res.status = vi.fn(() => res);
    res.setHeader = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  };

  test('401 with WWW-Authenticate when the key is wrong', async () => {
    const mcp = { isAuthorized: vi.fn().mockReturnValue(false), handle: vi.fn() };
    const res = fakeRes();
    const req: any = { headers: { authorization: 'Bearer nope' }, method: 'POST', user: { id: 'u1' }, body: {} };
    await new McpController(mcp as never).handle(req, res as never);
    expect(mcp.isAuthorized).toHaveBeenCalledWith('Bearer nope');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Missing or wrong MCP API key') });
    expect(mcp.handle).not.toHaveBeenCalled();
    expect(req.auth).toBeUndefined();
  });

  test('POST: attaches authInfo for the dev user and passes the parsed body', async () => {
    const mcp = { isAuthorized: vi.fn().mockReturnValue(true), handle: vi.fn().mockResolvedValue(undefined) };
    const res = fakeRes();
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const req: any = { headers: {}, method: 'POST', user: { id: 'u1', email: 'a@b' }, body };
    await new McpController(mcp as never).handle(req, res as never);
    expect(mcp.isAuthorized).toHaveBeenCalledWith(undefined);
    expect(req.auth).toEqual({ token: 'dev', clientId: 'u1', scopes: [], extra: { userId: 'u1' } });
    expect(mcp.handle).toHaveBeenCalledWith(req, res, body);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('non-POST requests get no body', async () => {
    const mcp = { isAuthorized: vi.fn().mockReturnValue(true), handle: vi.fn().mockResolvedValue(undefined) };
    const req: any = { headers: {}, method: 'GET', user: { id: 'u1' }, body: { ignored: true } };
    const res = fakeRes();
    await new McpController(mcp as never).handle(req, res as never);
    expect(mcp.handle).toHaveBeenCalledWith(req, res, undefined);
  });
});
