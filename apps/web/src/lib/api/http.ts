import type { ApiErrorBody } from '@syslab/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: ApiErrorBody) {
    super(message);
  }
  get isConflict() { return this.status === 409; }
  get isNotFound() { return this.status === 404; }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The only place that talks to the network. Every *.api.ts file goes through here. */
async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method,
    signal,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = data?.message ? (Array.isArray(data.message) ? data.message.join(', ') : data.message) : res.statusText;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const http = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: (path: string) => request<void>('DELETE', path),
};
