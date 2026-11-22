import { describe, test, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NotFoundException } from '@nestjs/common';
import { DesignsController } from '../src/designs/designs.controller';
import { HealthController } from '../src/health/health.controller';
import { VersionsController } from '../src/versions/versions.controller';
import { VersionsService } from '../src/versions/versions.service';
import { IS_PUBLIC } from '../src/common/auth/public.decorator';
import { CreateDesignDto } from '../src/designs/dto/create-design.dto';
import { ImportDesignDto } from '../src/designs/dto/import-design.dto';
import { ListDesignsQuery } from '../src/designs/dto/list-designs.query';
import { UpdateShareDto } from '../src/designs/dto/share.dto';
import { UpdateDesignDto } from '../src/designs/dto/update-design.dto';
import { CreateVersionDto } from '../src/versions/dto/create-version.dto';

const user = { id: 'u1', email: 'a@b' };

describe('DesignsController delegates to DesignsService', () => {
  const svc = {
    list: vi.fn().mockReturnValue('list'),
    create: vi.fn().mockReturnValue('create'),
    importSpec: vi.fn().mockReturnValue('import'),
    get: vi.fn().mockReturnValue('get'),
    update: vi.fn().mockReturnValue('update'),
    duplicate: vi.fn().mockReturnValue('dup'),
    setShare: vi.fn().mockReturnValue('share'),
    remove: vi.fn().mockReturnValue('remove'),
    getShared: vi.fn().mockReturnValue('shared'),
  };
  const ctl = new DesignsController(svc as never);

  test('every route', () => {
    expect(ctl.list(user, { limit: 10, cursor: 'c' })).toBe('list');
    expect(svc.list).toHaveBeenCalledWith('u1', 10, 'c');
    expect(ctl.create(user, { template: 'url', name: 'n' })).toBe('create');
    expect(svc.create).toHaveBeenCalledWith('u1', { template: 'url', name: 'n' });
    expect(ctl.importSpec(user, { spec: { a: 1 } })).toBe('import');
    expect(svc.importSpec).toHaveBeenCalledWith('u1', { a: 1 });
    expect(ctl.get(user, 'd1')).toBe('get');
    expect(svc.get).toHaveBeenCalledWith('u1', 'd1');
    expect(ctl.update(user, 'd1', { revision: 2, name: 'x' })).toBe('update');
    expect(svc.update).toHaveBeenCalledWith('u1', 'd1', { revision: 2, name: 'x' });
    expect(ctl.duplicate(user, 'd1')).toBe('dup');
    expect(svc.duplicate).toHaveBeenCalledWith('u1', 'd1');
    expect(ctl.share(user, 'd1', { enabled: true })).toBe('share');
    expect(svc.setShare).toHaveBeenCalledWith('u1', 'd1', true);
    expect(ctl.remove(user, 'd1')).toBe('remove');
    expect(svc.remove).toHaveBeenCalledWith('u1', 'd1');
    expect(ctl.shared('tok')).toBe('shared');
    expect(svc.getShared).toHaveBeenCalledWith('tok');
  });

  test('only the shared-link route is public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, DesignsController.prototype.shared)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC, DesignsController.prototype.get)).toBeUndefined();
  });
});

describe('HealthController', () => {
  test('pings the database and reports ok', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    await expect(new HealthController(prisma as never).check()).resolves.toEqual({ ok: true });
    const [strings] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('')).toBe('SELECT 1');
    expect(Reflect.getMetadata(IS_PUBLIC, HealthController.prototype.check)).toBe(true);
  });

  test('a database failure propagates', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('down')) };
    await expect(new HealthController(prisma as never).check()).rejects.toThrow('down');
  });
});

describe('VersionsController', () => {
  test('delegates to VersionsService', () => {
    const svc = { list: vi.fn().mockReturnValue('l'), create: vi.fn().mockReturnValue('c'), restore: vi.fn().mockReturnValue('r') };
    const ctl = new VersionsController(svc as never);
    expect(ctl.list(user, 'd1')).toBe('l');
    expect(svc.list).toHaveBeenCalledWith('u1', 'd1');
    expect(ctl.create(user, 'd1', { name: 'v' })).toBe('c');
    expect(svc.create).toHaveBeenCalledWith('u1', 'd1', 'v');
    expect(ctl.restore(user, 'd1', 'v1')).toBe('r');
    expect(svc.restore).toHaveBeenCalledWith('u1', 'd1', 'v1');
  });
});

describe('VersionsService', () => {
  const at = new Date('2026-03-01T00:00:00.000Z');
  const make = () => {
    const repo = {
      list: vi.fn().mockResolvedValue([{ id: 'v1', name: 'v1', note: 'n', createdAt: at }]),
      count: vi.fn().mockResolvedValue(2),
      create: vi.fn(async (_d: string, name: string, note: string) => ({ id: 'v3', name, note, createdAt: at })),
      findSnapshot: vi.fn(),
    };
    const doc = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e' }] };
    const designs = { get: vi.fn().mockResolvedValue({ id: 'd1', doc }), replaceDoc: vi.fn().mockResolvedValue('restored') };
    return { repo, designs, doc, svc: new VersionsService(repo as never, designs as never) };
  };

  test('list maps rows', async () => {
    const { svc, repo } = make();
    await expect(svc.list('o1', 'd1')).resolves.toEqual([{ id: 'v1', name: 'v1', note: 'n', createdAt: '2026-03-01T00:00:00.000Z' }]);
    expect(repo.list).toHaveBeenCalledWith('d1', 'o1');
  });

  test('create snapshots the saved design with an auto name', async () => {
    const { svc, repo, designs, doc } = make();
    const v = await svc.create('o1', 'd1');
    expect(designs.get).toHaveBeenCalledWith('o1', 'd1');
    expect(repo.create).toHaveBeenCalledWith('d1', 'v3', '2 components · 1 links', doc);
    expect(v).toEqual({ id: 'v3', name: 'v3', note: '2 components · 1 links', createdAt: '2026-03-01T00:00:00.000Z' });
  });

  test('create uses a trimmed custom name; blank falls back', async () => {
    const { svc, repo } = make();
    await svc.create('o1', 'd1', '  Before launch ');
    expect(repo.create.mock.calls[0][1]).toBe('Before launch');
    await svc.create('o1', 'd1', '  ');
    expect(repo.create.mock.calls[1][1]).toBe('v3');
  });

  test('create on a missing design propagates the 404', async () => {
    const { svc, designs, repo } = make();
    designs.get.mockRejectedValue(new NotFoundException());
    await expect(svc.create('o1', 'd1')).rejects.toThrow(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  test('restore replaces the doc, or 404', async () => {
    const { svc, repo, designs } = make();
    repo.findSnapshot.mockResolvedValueOnce({ id: 'v1', name: 'v1', snapshot: { s: 1 } }).mockResolvedValueOnce(null);
    await expect(svc.restore('o1', 'd1', 'v1')).resolves.toBe('restored');
    expect(repo.findSnapshot).toHaveBeenCalledWith('v1', 'd1', 'o1');
    expect(designs.replaceDoc).toHaveBeenCalledWith('o1', 'd1', { s: 1 });
    await expect(svc.restore('o1', 'd1', 'v9')).rejects.toThrow('Version not found');
  });
});

describe('DTO validation', () => {
  const errors = (cls: new () => object, plain: object) =>
    validateSync(plainToInstance(cls, plain) as object).map((e) => e.property);

  test('CreateDesignDto', () => {
    expect(errors(CreateDesignDto, { template: 'url' })).toEqual([]);
    expect(errors(CreateDesignDto, { template: 'lesson', name: 'ok' })).toEqual([]);
    expect(errors(CreateDesignDto, { template: 'nope' })).toEqual(['template']);
    expect(errors(CreateDesignDto, { template: 'url', name: 'x'.repeat(121) })).toEqual(['name']);
    expect(errors(CreateDesignDto, { template: 'url', name: 5 })).toEqual(['name']);
  });

  test('ImportDesignDto', () => {
    expect(errors(ImportDesignDto, { spec: { name: 'x' } })).toEqual([]);
    expect(errors(ImportDesignDto, { spec: 'x' })).toEqual(['spec']);
    expect(errors(ImportDesignDto, {})).toEqual(['spec']);
  });

  test('ListDesignsQuery converts limit from a query string', () => {
    const q = plainToInstance(ListDesignsQuery, { limit: '25', cursor: 'c' });
    expect(q.limit).toBe(25);
    expect(validateSync(q)).toEqual([]);
    expect(errors(ListDesignsQuery, {})).toEqual([]);
    expect(errors(ListDesignsQuery, { limit: '0' })).toEqual(['limit']);
    expect(errors(ListDesignsQuery, { limit: '101' })).toEqual(['limit']);
    expect(errors(ListDesignsQuery, { limit: '1.5' })).toEqual(['limit']);
    expect(errors(ListDesignsQuery, { cursor: 7 })).toEqual(['cursor']);
  });

  test('UpdateShareDto', () => {
    expect(errors(UpdateShareDto, { enabled: false })).toEqual([]);
    expect(errors(UpdateShareDto, { enabled: 'yes' })).toEqual(['enabled']);
  });

  test('UpdateDesignDto', () => {
    expect(errors(UpdateDesignDto, { revision: 1 })).toEqual([]);
    expect(errors(UpdateDesignDto, { revision: 1, name: 'n', doc: {} })).toEqual([]);
    expect(errors(UpdateDesignDto, { revision: 0 })).toEqual(['revision']);
    expect(errors(UpdateDesignDto, {})).toEqual(['revision']);
    expect(errors(UpdateDesignDto, { revision: 1, doc: [] })).toEqual(['doc']);
    expect(errors(UpdateDesignDto, { revision: 1, name: 'x'.repeat(121) })).toEqual(['name']);
  });

  test('CreateVersionDto', () => {
    expect(errors(CreateVersionDto, {})).toEqual([]);
    expect(errors(CreateVersionDto, { name: 'v' })).toEqual([]);
    expect(errors(CreateVersionDto, { name: 'x'.repeat(81) })).toEqual(['name']);
  });
});
