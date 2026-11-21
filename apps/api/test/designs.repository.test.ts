import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { DesignsRepository } from '../src/designs/designs.repository';
import { UsersRepository } from '../src/users/users.repository';
import { VersionsRepository } from '../src/versions/versions.repository';

const designSelect = {
  id: true, name: true, doc: true, revision: true, shareEnabled: true, shareToken: true, createdAt: true, updatedAt: true,
};
const summarySelect = { id: true, name: true, summary: true, updatedAt: true };

function fakePrisma() {
  return {
    design: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'd1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ id: 'd1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    designVersion: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(3),
      create: vi.fn().mockResolvedValue({ id: 'v1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: { upsert: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b' }) },
  };
}

describe('DesignsRepository', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let repo: DesignsRepository;
  beforeEach(() => {
    prisma = fakePrisma();
    repo = new DesignsRepository(prisma as never);
  });
  afterEach(() => { vi.useRealTimers(); });

  test('listByOwner without a cursor', async () => {
    prisma.design.findMany.mockResolvedValue([{ id: 'a' }]);
    await expect(repo.listByOwner('o1', 10)).resolves.toEqual([{ id: 'a' }]);
    expect(prisma.design.findMany).toHaveBeenCalledWith({
      where: { ownerId: 'o1' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: summarySelect,
    });
  });

  test('listByOwner with a cursor skips the cursor row', async () => {
    await repo.listByOwner('o1', 5, 'c9');
    expect(prisma.design.findMany).toHaveBeenCalledWith({
      where: { ownerId: 'o1' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      cursor: { id: 'c9' },
      skip: 1,
      select: summarySelect,
    });
  });

  test('findOwned and findShared', async () => {
    await repo.findOwned('d1', 'o1');
    expect(prisma.design.findFirst).toHaveBeenLastCalledWith({ where: { id: 'd1', ownerId: 'o1' }, select: designSelect });
    await repo.findShared('tok');
    expect(prisma.design.findFirst).toHaveBeenLastCalledWith({ where: { shareToken: 'tok', shareEnabled: true }, select: designSelect });
  });

  test('exists maps the count to a boolean', async () => {
    prisma.design.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await expect(repo.exists('d1', 'o1')).resolves.toBe(false);
    await expect(repo.exists('d1', 'o1')).resolves.toBe(true);
    expect(prisma.design.count).toHaveBeenCalledWith({ where: { id: 'd1', ownerId: 'o1' } });
  });

  test('create', async () => {
    await expect(repo.create('o1', 'N', { a: 1 }, { s: 1 })).resolves.toEqual({ id: 'd1' });
    expect(prisma.design.create).toHaveBeenCalledWith({ data: { ownerId: 'o1', name: 'N', doc: { a: 1 }, summary: { s: 1 } }, select: designSelect });
  });

  test('updateIfRevision returns the next revision on success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    await expect(repo.updateIfRevision('d1', 'o1', 4, { name: 'X' })).resolves.toEqual({ revision: 5, updatedAt: new Date('2026-01-02T03:04:05Z') });
    expect(prisma.design.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', ownerId: 'o1', revision: 4 },
      data: { name: 'X', revision: { increment: 1 } },
    });
  });

  test('updateIfRevision returns null when nothing matched', async () => {
    prisma.design.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.updateIfRevision('d1', 'o1', 4, {})).resolves.toBeNull();
  });

  test('replaceDoc with and without a name', async () => {
    await repo.replaceDoc('d1', 'o1', { d: 1 }, { s: 1 });
    expect(prisma.design.update).toHaveBeenLastCalledWith({
      where: { id: 'd1', ownerId: 'o1' },
      data: { doc: { d: 1 }, summary: { s: 1 }, revision: { increment: 1 } },
      select: designSelect,
    });
    await repo.replaceDoc('d1', 'o1', { d: 1 }, { s: 1 }, 'New');
    expect(prisma.design.update).toHaveBeenLastCalledWith({
      where: { id: 'd1', ownerId: 'o1' },
      data: { doc: { d: 1 }, summary: { s: 1 }, revision: { increment: 1 }, name: 'New' },
      select: designSelect,
    });
  });

  test('setShare', async () => {
    await repo.setShare('d1', 'o1', true, 'tok');
    expect(prisma.design.update).toHaveBeenCalledWith({
      where: { id: 'd1', ownerId: 'o1' },
      data: { shareEnabled: true, shareToken: 'tok' },
      select: { shareEnabled: true, shareToken: true },
    });
  });

  test('delete reports whether a row was removed', async () => {
    prisma.design.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.delete('d1', 'o1')).resolves.toBe(true);
    await expect(repo.delete('d1', 'o1')).resolves.toBe(false);
    expect(prisma.design.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', ownerId: 'o1' } });
  });
});

describe('UsersRepository', () => {
  test('upsertByEmail creates the user or returns the existing one', async () => {
    const prisma = fakePrisma();
    const repo = new UsersRepository(prisma as never);
    await expect(repo.upsertByEmail('a@b', 'A')).resolves.toEqual({ id: 'u1', email: 'a@b' });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { email: 'a@b' },
      update: {},
      create: { email: 'a@b', name: 'A' },
      select: { id: true, email: true },
    });
  });
});

describe('VersionsRepository', () => {
  const listSelect = { id: true, name: true, note: true, createdAt: true };
  let prisma: ReturnType<typeof fakePrisma>;
  let repo: VersionsRepository;
  beforeEach(() => {
    prisma = fakePrisma();
    repo = new VersionsRepository(prisma as never);
  });

  test('list is scoped through the parent design owner', async () => {
    await repo.list('d1', 'o1');
    expect(prisma.designVersion.findMany).toHaveBeenCalledWith({
      where: { designId: 'd1', design: { ownerId: 'o1' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: listSelect,
    });
  });

  test('count', async () => {
    await expect(repo.count('d1')).resolves.toBe(3);
    expect(prisma.designVersion.count).toHaveBeenCalledWith({ where: { designId: 'd1' } });
  });

  test('create', async () => {
    await repo.create('d1', 'v1', 'note', { x: 1 });
    expect(prisma.designVersion.create).toHaveBeenCalledWith({ data: { designId: 'd1', name: 'v1', note: 'note', snapshot: { x: 1 } }, select: listSelect });
  });

  test('findSnapshot', async () => {
    await repo.findSnapshot('v1', 'd1', 'o1');
    expect(prisma.designVersion.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', designId: 'd1', design: { ownerId: 'o1' } },
      select: { id: true, name: true, snapshot: true },
    });
  });
});
