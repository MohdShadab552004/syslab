import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, http } from '@/lib/api/http';
import { designsApi } from '@/lib/api/designs.api';
import { versionsApi } from '@/lib/api/versions.api';
import { qk } from '@/lib/api/query-keys';
import { cx } from '@/lib/utils/cx';
import { SHORTCUT_GROUPS, SPIKE_STEPS } from '@/lib/editor/shortcuts';

const BASE = 'http://localhost:4000/api';

function res(status: number, body?: unknown, statusText = 'Status') {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText,
    json: body === undefined ? () => Promise.reject(new Error('no body')) : () => Promise.resolve(body),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('http', () => {
  it('GET sends no body or headers and returns parsed json', async () => {
    fetchMock.mockResolvedValue(res(200, { a: 1 }));
    const signal = new AbortController().signal;
    await expect(http.get('/x', signal)).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledWith(BASE + '/x', {
      method: 'GET', signal, credentials: 'include', headers: undefined, body: undefined,
    });
  });

  it('POST defaults to an empty json body', async () => {
    fetchMock.mockResolvedValue(res(201, { id: 'd' }));
    await http.post('/p');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.body).toBe('{}');
  });

  it('POST and PATCH send the given body', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await http.post('/p', { a: 1 });
    await http.patch('/q', { b: 2 });
    expect(fetchMock.mock.calls[0][1].body).toBe('{"a":1}');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"b":2}' });
  });

  it('204 resolves to undefined without reading json', async () => {
    const r = res(204);
    fetchMock.mockResolvedValue(r);
    await expect(http.del('/d')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('error with a string message', async () => {
    fetchMock.mockResolvedValue(res(409, { message: 'conflict!' }));
    const err = await http.get('/c').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('conflict!');
    expect(err.status).toBe(409);
    expect(err.isConflict).toBe(true);
    expect(err.isNotFound).toBe(false);
    expect(err.body).toEqual({ message: 'conflict!' });
  });

  it('error with an array message joins it', async () => {
    fetchMock.mockResolvedValue(res(400, { message: ['a', 'b'] }));
    const err = await http.get('/c').catch((e) => e);
    expect(err.message).toBe('a, b');
    expect(err.isConflict).toBe(false);
  });

  it('error without a json body falls back to statusText', async () => {
    fetchMock.mockResolvedValue(res(404, undefined, 'Not Found'));
    const err = await http.get('/c').catch((e) => e);
    expect(err.message).toBe('Not Found');
    expect(err.isNotFound).toBe(true);
    expect(err.body).toBeUndefined();
  });

  it('error with a json body but no message falls back to statusText', async () => {
    fetchMock.mockResolvedValue(res(500, { other: 1 }, 'Server Error'));
    const err = await http.get('/c').catch((e) => e);
    expect(err.message).toBe('Server Error');
  });

  it('uses NEXT_PUBLIC_API_URL when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    vi.resetModules();
    const mod = await import('@/lib/api/http');
    fetchMock.mockResolvedValue(res(200, {}));
    await mod.http.get('/z');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/z');
  });
});

describe('designsApi / versionsApi', () => {
  beforeEach(() => fetchMock.mockResolvedValue(res(200, { ok: true })));
  const call = (i = 0) => ({ url: fetchMock.mock.calls[i][0], init: fetchMock.mock.calls[i][1] });

  it('designs endpoints', async () => {
    const signal = new AbortController().signal;
    await designsApi.list(signal);
    expect(call(0)).toMatchObject({ url: BASE + '/designs?limit=50', init: { method: 'GET', signal } });
    await designsApi.get('d1');
    expect(call(1).url).toBe(BASE + '/designs/d1');
    await designsApi.getShared('tok');
    expect(call(2).url).toBe(BASE + '/public/designs/tok');
    await designsApi.create({ template: 'blank', name: 'n' });
    expect(call(3)).toMatchObject({ url: BASE + '/designs', init: { method: 'POST', body: '{"template":"blank","name":"n"}' } });
    await designsApi.update('d1', { revision: 3, name: 'x' });
    expect(call(4)).toMatchObject({ url: BASE + '/designs/d1', init: { method: 'PATCH' } });
    await designsApi.duplicate('d1');
    expect(call(5)).toMatchObject({ url: BASE + '/designs/d1/duplicate', init: { method: 'POST', body: '{}' } });
    await designsApi.setShare('d1', true);
    expect(call(6)).toMatchObject({ url: BASE + '/designs/d1/share', init: { method: 'PATCH', body: '{"enabled":true}' } });
    await designsApi.remove('d1');
    expect(call(7)).toMatchObject({ url: BASE + '/designs/d1', init: { method: 'DELETE' } });
  });

  it('versions endpoints', async () => {
    await versionsApi.list('d1');
    expect(call(0).url).toBe(BASE + '/designs/d1/versions');
    await versionsApi.create('d1');
    expect(call(1)).toMatchObject({ url: BASE + '/designs/d1/versions', init: { method: 'POST', body: '{}' } });
    await versionsApi.create('d1', { label: 'v' } as never);
    expect(call(2).init.body).toBe('{"label":"v"}');
    await versionsApi.restore('d1', 'v1');
    expect(call(3)).toMatchObject({ url: BASE + '/designs/d1/versions/v1/restore', init: { method: 'POST' } });
  });
});

describe('query keys', () => {
  it('builds stable keys', () => {
    expect(qk.designs).toEqual(['designs']);
    expect(qk.design('a')).toEqual(['designs', 'a']);
    expect(qk.versions('a')).toEqual(['designs', 'a', 'versions']);
  });
});

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});

describe('shortcuts', () => {
  it('lists groups with rows', () => {
    expect(SPIKE_STEPS).toEqual([1, 2, 10, 50, 100]);
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual(['Tools', 'Edit', 'Selection', 'Canvas', 'Simulation']);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.rows.length).toBeGreaterThan(0);
      for (const r of g.rows) { expect(r.keys.length).toBeGreaterThan(0); expect(r.label).toBeTruthy(); }
    }
    expect(SHORTCUT_GROUPS.flatMap((g) => g.rows).filter((r) => r.sep === ' ').length).toBe(2);
  });
});
