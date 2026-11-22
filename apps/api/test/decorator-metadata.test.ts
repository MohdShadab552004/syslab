/**
 * With emitDecoratorMetadata the compiler records constructor parameter types as
 * `typeof X === 'undefined' ? Object : X`. The `Object` fallback is what Nest sees when a
 * provider class is not defined yet at decoration time (a circular import), and Nest then
 * fails with "can't resolve dependencies". This file loads every injectable with its
 * dependencies stubbed out as `undefined` to check that fallback (and so both sides of
 * these compiler-generated branches run under coverage).
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../src/prisma/prisma.service', () => ({ PrismaService: undefined }));
vi.mock('../src/designs/designs.service', () => ({ DesignsService: undefined }));
vi.mock('../src/designs/designs.repository', () => ({ DesignsRepository: undefined }));
vi.mock('../src/versions/versions.service', () => ({ VersionsService: undefined }));
vi.mock('../src/versions/versions.repository', () => ({ VersionsRepository: undefined }));
vi.mock('../src/users/users.repository', () => ({ UsersRepository: undefined }));
vi.mock('../src/mcp/mcp.service', () => ({ McpService: undefined }));

const paramTypes = (cls: unknown) => Reflect.getMetadata('design:paramtypes', cls as object) as unknown[];

describe('constructor metadata falls back to Object for undefined providers', () => {
  test.each([
    ['../src/designs/designs.controller', 'DesignsController', 1],
    ['../src/designs/designs.service', 'DesignsService', 1],
    ['../src/designs/designs.repository', 'DesignsRepository', 1],
    ['../src/health/health.controller', 'HealthController', 1],
    ['../src/users/users.repository', 'UsersRepository', 1],
    ['../src/versions/versions.controller', 'VersionsController', 1],
    ['../src/versions/versions.service', 'VersionsService', 2],
    ['../src/versions/versions.repository', 'VersionsRepository', 1],
    ['../src/mcp/mcp.controller', 'McpController', 1],
  ])('%s', async (path, name, count) => {
    const mod = await vi.importActual<Record<string, unknown>>(path);
    expect(paramTypes(mod[name])).toEqual(Array(count).fill(Object));
  });

  test('McpService (DesignsService undefined, ConfigService real)', async () => {
    const { McpService } = await vi.importActual<typeof import('../src/mcp/mcp.service')>('../src/mcp/mcp.service');
    const { ConfigService } = await import('@nestjs/config');
    expect(paramTypes(McpService)).toEqual([Object, ConfigService]);
  });

  test('DevAuthGuard (UsersRepository undefined)', async () => {
    const { DevAuthGuard } = await import('../src/common/auth/dev-auth.guard');
    expect(paramTypes(DevAuthGuard)[1]).toBe(Object);
  });
});

describe('property metadata', () => {
  test('ImportDesignDto.spec is recorded as Object (Record is only a type)', async () => {
    const { ImportDesignDto } = await import('../src/designs/dto/import-design.dto');
    expect(Reflect.getMetadata('design:type', ImportDesignDto.prototype, 'spec')).toBe(Object);
  });

  test('the same emitted check picks up a runtime value named Record if one exists', async () => {
    const g = globalThis as { Record?: unknown };
    function Record() {}
    g.Record = Record;
    try {
      vi.resetModules();
      const { ImportDesignDto } = await vi.importActual<typeof import('../src/designs/dto/import-design.dto')>('../src/designs/dto/import-design.dto');
      expect(Reflect.getMetadata('design:type', ImportDesignDto.prototype, 'spec')).toBe(Record);
    } finally {
      delete g.Record;
    }
  });
});
