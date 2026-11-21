import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildTemplate, summarize } from '@syslab/sim';
import type { DesignDoc } from '@syslab/types';
import { DesignsService } from '../src/designs/designs.service';
import { toDesign, toSummary } from '../src/designs/designs.mapper';

const created = new Date('2026-01-01T00:00:00.000Z');
const updated = new Date('2026-02-01T00:00:00.000Z');
const urlDoc = () => structuredClone(buildTemplate('url').doc) as DesignDoc;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', name: 'My design', doc: urlDoc(), revision: 3, shareEnabled: false, shareToken: null as string | null,
  createdAt: created, updatedAt: updated, ...over,
});

function fakeRepo() {
  return {
    listByOwner: vi.fn(),
    findOwned: vi.fn(),
    exists: vi.fn(),
    findShared: vi.fn(),
    create: vi.fn(async (_o: string, name: string, doc: unknown) => row({ id: 'new', name, doc })),
    updateIfRevision: vi.fn(),
    replaceDoc: vi.fn(async (id: string, _o: string, doc: unknown, _s: unknown, name?: string) => row({ id, doc, name: name ?? 'My design', revision: 4 })),
    setShare: vi.fn(async (_id: string, _o: string, shareEnabled: boolean, shareToken: string | null) => ({ shareEnabled, shareToken })),
    delete: vi.fn(),
  };
}

describe('designs.mapper', () => {
  test('toDesign converts dates to ISO strings', () => {
    const r = row();
    expect(toDesign(r as never)).toEqual({
      id: 'd1', name: 'My design', doc: r.doc, revision: 3, shareEnabled: false, shareToken: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  test('toSummary reads the stored summary', () => {
    const summary = { isLesson: true, nodeCount: 4, flowCount: 2, previewKinds: ['app', 'db'] };
    expect(toSummary({ id: 'd1', name: 'N', summary, updatedAt: updated } as never)).toEqual({
      id: 'd1', name: 'N', isLesson: true, nodeCount: 4, flowCount: 2, previewKinds: ['app', 'db'], updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  test('toSummary fills defaults for an empty summary', () => {
    expect(toSummary({ id: 'd1', name: 'N', summary: {}, updatedAt: updated } as never)).toEqual({
      id: 'd1', name: 'N', isLesson: false, nodeCount: 0, flowCount: 0, previewKinds: [], updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('DesignsService', () => {
  let repo: ReturnType<typeof fakeRepo>;
  let svc: DesignsService;
  beforeEach(() => {
    repo = fakeRepo();
    svc = new DesignsService(repo as never);
  });

  describe('list', () => {
    const summaryRow = (id: string) => ({ id, name: id, summary: { nodeCount: 1, flowCount: 0, previewKinds: [], isLesson: false }, updatedAt: updated });

    test('defaults to 50 and returns no cursor on a short page', async () => {
      repo.listByOwner.mockResolvedValue([summaryRow('a')]);
      const res = await svc.list('o1');
      expect(repo.listByOwner).toHaveBeenCalledWith('o1', 50, undefined);
      expect(res.nextCursor).toBeNull();
      expect(res.items.map((i) => i.id)).toEqual(['a']);
    });

    test('a full page returns the last id as the cursor', async () => {
      repo.listByOwner.mockResolvedValue([summaryRow('a'), summaryRow('b')]);
      const res = await svc.list('o1', 2, 'z');
      expect(repo.listByOwner).toHaveBeenCalledWith('o1', 2, 'z');
      expect(res.nextCursor).toBe('b');
    });
  });

  test('get returns the design or 404', async () => {
    repo.findOwned.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(svc.get('o1', 'd1')).resolves.toMatchObject({ id: 'd1', name: 'My design' });
    expect(repo.findOwned).toHaveBeenCalledWith('d1', 'o1');
    await expect(svc.get('o1', 'nope')).rejects.toThrow(NotFoundException);
  });

  test('getShared hides the share token, or 404', async () => {
    repo.findShared.mockResolvedValueOnce(row({ shareEnabled: true, shareToken: 'tok' })).mockResolvedValueOnce(null);
    const d = await svc.getShared('tok');
    expect(d.shareToken).toBeNull();
    expect(d.shareEnabled).toBe(true);
    await expect(svc.getShared('bad')).rejects.toThrow(NotFoundException);
  });

  describe('create', () => {
    test('uses the given name, trimmed', async () => {
      const d = await svc.create('o1', { template: 'url', name: '  Shortener  ' });
      const t = buildTemplate('url');
      expect(repo.create).toHaveBeenCalledWith('o1', 'Shortener', t.doc, summarize(t.doc));
      expect(d.name).toBe('Shortener');
    });

    test('falls back to the template name for a missing or blank name', async () => {
      await svc.create('o1', { template: 'blank' });
      expect(repo.create.mock.calls[0][1]).toBe(buildTemplate('blank').name);
      await svc.create('o1', { template: 'chat', name: '   ' });
      expect(repo.create.mock.calls[1][1]).toBe(buildTemplate('chat').name);
    });
  });

  describe('importSpec', () => {
    const spec = {
      name: 'Imported',
      components: [{ name: 'Users', kind: 'users' }, { name: 'API', kind: 'app' }, { name: 'DB', kind: 'db', size: '2vCPU' }],
      connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'DB' }, { from: 'API', to: 'DB' }],
    };

    test('creates the design and returns warnings', async () => {
      const d = await svc.importSpec('o1', spec);
      expect(d.name).toBe('Imported');
      expect(d.warnings).toEqual(['Duplicate connection API → DB was ignored.']);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    test('a bad spec becomes a 400 listing every issue', async () => {
      const err = await svc.importSpec('o1', { name: 'X', components: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse();
      expect(body.message).toMatch(/Design spec has 1 problem/);
      expect(body.issues).toEqual([expect.objectContaining({ path: 'components' })]);
      expect(repo.create).not.toHaveBeenCalled();
    });

    test('other errors are rethrown unchanged', async () => {
      const boom = new Error('db down');
      repo.create.mockRejectedValueOnce(boom);
      await expect(svc.importSpec('o1', spec)).rejects.toBe(boom);
    });
  });

  describe('createFromDoc', () => {
    test('trims the name, defaults a blank one', async () => {
      const doc = urlDoc();
      await svc.createFromDoc('o1', ' A ', doc);
      expect(repo.create).toHaveBeenLastCalledWith('o1', 'A', doc, summarize(doc));
      await svc.createFromDoc('o1', '  ', doc);
      expect(repo.create).toHaveBeenLastCalledWith('o1', 'Untitled design', doc, summarize(doc));
    });
  });

  describe('assertValidDoc (through createFromDoc)', () => {
    const reject = async (mutate: (d: DesignDoc & Record<string, unknown>) => void, message: string | RegExp) => {
      const doc = urlDoc() as DesignDoc & Record<string, unknown>;
      mutate(doc);
      await expect(svc.createFromDoc('o1', 'x', doc)).rejects.toThrow(message);
      await expect(svc.createFromDoc('o1', 'x', doc)).rejects.toBeInstanceOf(BadRequestException);
    };

    test('schemaVersion', () => reject((d) => { (d as { schemaVersion: number }).schemaVersion = 2; }, 'Unsupported schemaVersion'));
    test.each(['nodes', 'edges', 'groups', 'notes', 'flows'])('%s must be an array', (k) => reject((d) => { d[k] = {}; }, `doc.${k} must be an array`));
    test.each([['nodes', 400], ['edges', 1600], ['groups', 100], ['notes', 200], ['flows', 100]] as const)('too many %s', (k, max) =>
      reject((d) => {
        const filler = Array.from({ length: max + 1 }, (_, i) => ({ id: `${k}${i}` }));
        if (k === 'edges') d.edges = filler as never; else d[k] = filler;
      }, `Too many ${k} (max ${max})`));
    test('users must be a non-negative number', async () => {
      await reject((d) => { (d as { users: unknown }).users = '5'; }, 'doc.users must be a number, 0 or more');
      await reject((d) => { d.users = -1; }, 'doc.users must be a number, 0 or more');
    });
    test('requirements are required', async () => {
      await reject((d) => { (d as { requirements: unknown }).requirements = null; }, 'doc.requirements is required');
      await reject((d) => { (d as { requirements: unknown }).requirements = 'x'; }, 'doc.requirements is required');
    });
    test('duplicate node ids', () => reject((d) => { d.nodes.push({ ...d.nodes[0] }); }, 'Duplicate node ids'));
    test('edges must point at existing nodes', async () => {
      await reject((d) => { d.edges[0] = { ...d.edges[0], from: 'ghost' }; }, `Edge ${urlDoc().edges[0].id} points to a missing node`);
      await reject((d) => { d.edges[0] = { ...d.edges[0], to: 'ghost' }; }, /points to a missing node/);
    });
    test('zero users is allowed', async () => {
      const doc = urlDoc();
      doc.users = 0;
      await expect(svc.createFromDoc('o1', 'x', doc)).resolves.toBeDefined();
    });
  });

  describe('replaceFromSpec', () => {
    test('replaces name and doc when the design exists', async () => {
      repo.exists.mockResolvedValue(true);
      const doc = urlDoc();
      const d = await svc.replaceFromSpec('o1', 'd1', ' Renamed ', doc);
      expect(repo.exists).toHaveBeenCalledWith('d1', 'o1');
      expect(repo.replaceDoc).toHaveBeenCalledWith('d1', 'o1', doc, summarize(doc), 'Renamed');
      expect(d).toMatchObject({ id: 'd1', name: 'Renamed', revision: 4 });
      await svc.replaceFromSpec('o1', 'd1', '', doc);
      expect(repo.replaceDoc).toHaveBeenLastCalledWith('d1', 'o1', doc, summarize(doc), 'Untitled design');
    });

    test('404 when missing, 400 on a bad doc (checked first)', async () => {
      repo.exists.mockResolvedValue(false);
      await expect(svc.replaceFromSpec('o1', 'd1', 'n', urlDoc())).rejects.toThrow(NotFoundException);
      const bad = { ...urlDoc(), schemaVersion: 9 } as unknown as DesignDoc;
      await expect(svc.replaceFromSpec('o1', 'd1', 'n', bad)).rejects.toThrow(BadRequestException);
      expect(repo.replaceDoc).not.toHaveBeenCalled();
    });
  });

  test('duplicate copies the doc under "(copy)"', async () => {
    const src = row();
    repo.findOwned.mockResolvedValue(src);
    const d = await svc.duplicate('o1', 'd1');
    expect(repo.create).toHaveBeenCalledWith('o1', 'My design (copy)', src.doc, summarize(src.doc));
    expect(d.id).toBe('new');
  });

  test('duplicate of a missing design is a 404', async () => {
    repo.findOwned.mockResolvedValue(null);
    await expect(svc.duplicate('o1', 'x')).rejects.toThrow(NotFoundException);
  });

  describe('update', () => {
    test('name only', async () => {
      repo.updateIfRevision.mockResolvedValue({ revision: 4, updatedAt: updated });
      await expect(svc.update('o1', 'd1', { revision: 3, name: ' New ' })).resolves.toEqual({ revision: 4, updatedAt: '2026-02-01T00:00:00.000Z' });
      expect(repo.updateIfRevision).toHaveBeenCalledWith('d1', 'o1', 3, { name: 'New' });
    });

    test('blank name becomes "Untitled design"; doc sets doc + summary', async () => {
      repo.updateIfRevision.mockResolvedValue({ revision: 4, updatedAt: updated });
      const doc = urlDoc();
      await svc.update('o1', 'd1', { revision: 3, name: '', doc });
      expect(repo.updateIfRevision).toHaveBeenCalledWith('d1', 'o1', 3, { name: 'Untitled design', doc, summary: summarize(doc) });
    });

    test('nothing to change still bumps the revision', async () => {
      repo.updateIfRevision.mockResolvedValue({ revision: 4, updatedAt: updated });
      await svc.update('o1', 'd1', { revision: 3 });
      expect(repo.updateIfRevision).toHaveBeenCalledWith('d1', 'o1', 3, {});
    });

    test('invalid doc is rejected before touching the repo', async () => {
      await expect(svc.update('o1', 'd1', { revision: 3, doc: { ...urlDoc(), nodes: 'x' } as unknown as DesignDoc })).rejects.toThrow('doc.nodes must be an array');
      expect(repo.updateIfRevision).not.toHaveBeenCalled();
    });

    test('revision mismatch: 404 if missing, 409 otherwise', async () => {
      repo.updateIfRevision.mockResolvedValue(null);
      repo.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await expect(svc.update('o1', 'd1', { revision: 3 })).rejects.toThrow(NotFoundException);
      await expect(svc.update('o1', 'd1', { revision: 3 })).rejects.toThrow(ConflictException);
    });
  });

  test('replaceDoc keeps the name', async () => {
    const doc = urlDoc();
    const d = await svc.replaceDoc('o1', 'd1', doc);
    expect(repo.replaceDoc).toHaveBeenCalledWith('d1', 'o1', doc, summarize(doc));
    expect(d.revision).toBe(4);
  });

  describe('setShare', () => {
    test('enabling without a token creates one', async () => {
      repo.findOwned.mockResolvedValue(row());
      const s = await svc.setShare('o1', 'd1', true);
      expect(s.shareEnabled).toBe(true);
      expect(s.shareToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
    });

    test('enabling keeps an existing token', async () => {
      repo.findOwned.mockResolvedValue(row({ shareToken: 'keep' }));
      await expect(svc.setShare('o1', 'd1', true)).resolves.toEqual({ shareEnabled: true, shareToken: 'keep' });
    });

    test('disabling keeps the token (so re-enabling reuses the link)', async () => {
      repo.findOwned.mockResolvedValue(row({ shareEnabled: true, shareToken: 'keep' }));
      await expect(svc.setShare('o1', 'd1', false)).resolves.toEqual({ shareEnabled: false, shareToken: 'keep' });
      expect(repo.setShare).toHaveBeenCalledWith('d1', 'o1', false, 'keep');
    });

    test('404 for a missing design', async () => {
      repo.findOwned.mockResolvedValue(null);
      await expect(svc.setShare('o1', 'd1', true)).rejects.toThrow(NotFoundException);
    });
  });

  test('remove: ok or 404', async () => {
    repo.delete.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(svc.remove('o1', 'd1')).resolves.toBeUndefined();
    expect(repo.delete).toHaveBeenCalledWith('d1', 'o1');
    await expect(svc.remove('o1', 'd1')).rejects.toThrow(NotFoundException);
  });
});
