import { describe, test, expect, vi, afterEach } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import configuration from '../src/config/configuration';
import { PrismaExceptionFilter } from '../src/common/http/prisma-exception.filter';
import { Prisma } from '../src/generated/prisma/client';

const ENV = ['DATABASE_URL', 'PORT', 'CORS_ORIGIN', 'DEV_USER_EMAIL', 'WEB_URL', 'MCP_API_KEY'] as const;

describe('configuration()', () => {
  const clear = () => { for (const k of ENV) vi.stubEnv(k, undefined); };
  afterEach(() => { vi.unstubAllEnvs(); });

  test('throws without DATABASE_URL', () => {
    clear();
    expect(() => configuration()).toThrow('DATABASE_URL is not set');
    vi.stubEnv('DATABASE_URL', '');
    expect(() => configuration()).toThrow('DATABASE_URL is not set');
  });

  test('defaults when only DATABASE_URL is set', () => {
    clear();
    vi.stubEnv('DATABASE_URL', 'postgres://db');
    expect(configuration()).toEqual({
      port: 4000,
      corsOrigin: ['http://localhost:3000'],
      databaseUrl: 'postgres://db',
      devUserEmail: 'dev@syslab.local',
      webUrl: 'http://localhost:3000',
      mcpApiKey: null,
    });
  });

  test('reads every variable; WEB_URL wins over CORS_ORIGIN and loses its trailing slash', () => {
    clear();
    vi.stubEnv('DATABASE_URL', 'postgres://db');
    vi.stubEnv('PORT', '8080');
    vi.stubEnv('CORS_ORIGIN', 'http://a.com, http://b.com ');
    vi.stubEnv('DEV_USER_EMAIL', 'me@x.io');
    vi.stubEnv('WEB_URL', ' https://app.example.com/ ');
    vi.stubEnv('MCP_API_KEY', '  secret  ');
    expect(configuration()).toEqual({
      port: 8080,
      corsOrigin: ['http://a.com', 'http://b.com'],
      databaseUrl: 'postgres://db',
      devUserEmail: 'me@x.io',
      webUrl: 'https://app.example.com',
      mcpApiKey: 'secret',
    });
  });

  test('webUrl falls back to the first CORS origin', () => {
    clear();
    vi.stubEnv('DATABASE_URL', 'postgres://db');
    vi.stubEnv('CORS_ORIGIN', 'http://web.test/ ,http://other.test');
    expect(configuration().webUrl).toBe('http://web.test');
  });

  test('a blank MCP_API_KEY means no key', () => {
    clear();
    vi.stubEnv('DATABASE_URL', 'postgres://db');
    vi.stubEnv('MCP_API_KEY', '   ');
    expect(configuration().mcpApiKey).toBeNull();
  });
});

describe('PrismaExceptionFilter', () => {
  const run = (code: string) => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    const err = new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });
    new PrismaExceptionFilter().catch(err, host);
    return res;
  };

  test.each([
    ['P2025', 404, 'Not found'],
    ['P2002', 409, 'Already exists'],
    ['P2003', 400, 'Invalid reference'],
    ['P1001', 500, 'Database error'],
  ])('%s -> %i %s', (code, statusCode, message) => {
    const res = run(code);
    expect(res.status).toHaveBeenCalledWith(statusCode);
    expect(res.json).toHaveBeenCalledWith({ statusCode, message, error: code });
  });
});
