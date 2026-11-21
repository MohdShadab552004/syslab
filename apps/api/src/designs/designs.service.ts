import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { buildTemplate, summarize } from '@syslab/sim';
import { SpecError, buildDesign } from '@syslab/spec';
import type {
  CreateDesignInput, Design, DesignDoc, DesignSummary, ShareState, UpdateDesignInput, UpdateDesignResult,
} from '@syslab/types';
import type { Prisma } from '../generated/prisma/client';
import { DesignsRepository } from './designs.repository';
import { toDesign, toSummary } from './designs.mapper';

const LIMITS = { nodes: 400, edges: 1600, groups: 100, notes: 200, flows: 100 };
const json = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class DesignsService {
  constructor(private readonly repo: DesignsRepository) {}

  async list(ownerId: string, limit = 50, cursor?: string): Promise<{ items: DesignSummary[]; nextCursor: string | null }> {
    const rows = await this.repo.listByOwner(ownerId, limit, cursor);
    return { items: rows.map(toSummary), nextCursor: rows.length === limit ? rows[rows.length - 1].id : null };
  }

  async get(ownerId: string, id: string): Promise<Design> {
    const row = await this.repo.findOwned(id, ownerId);
    if (!row) throw new NotFoundException('Design not found');
    return toDesign(row);
  }

  async getShared(token: string): Promise<Design> {
    const row = await this.repo.findShared(token);
    if (!row) throw new NotFoundException('Design not found');
    return { ...toDesign(row), shareToken: null };
  }

  async create(ownerId: string, input: CreateDesignInput): Promise<Design> {
    const t = buildTemplate(input.template);
    const name = input.name?.trim() || t.name;
    const row = await this.repo.create(ownerId, name, json(t.doc), json(summarize(t.doc)));
    return toDesign(row);
  }

  /** Build a design from an AI-written spec; spec problems come back as a 400 with every issue listed. */
  async importSpec(ownerId: string, spec: unknown): Promise<Design & { warnings: string[] }> {
    try {
      const built = buildDesign(spec);
      return { ...(await this.createFromDoc(ownerId, built.name, built.doc)), warnings: built.warnings };
    } catch (e) {
      if (e instanceof SpecError) throw new BadRequestException({ message: e.message, issues: e.issues });
      throw e;
    }
  }

  /** Save a ready-made document as a new design (used by AI imports and the MCP server). */
  async createFromDoc(ownerId: string, name: string, doc: DesignDoc): Promise<Design> {
    this.assertValidDoc(doc);
    const row = await this.repo.create(ownerId, name.trim() || 'Untitled design', json(doc), json(summarize(doc)));
    return toDesign(row);
  }

  /**
   * Overwrite a design's name and document in one step, without a revision check (an AI rewrote
   * it). An editor tab that still has the old version open gets a conflict on its next save.
   */
  async replaceFromSpec(ownerId: string, id: string, name: string, doc: DesignDoc): Promise<Design> {
    this.assertValidDoc(doc);
    if (!(await this.repo.exists(id, ownerId))) throw new NotFoundException('Design not found');
    return toDesign(await this.repo.replaceDoc(id, ownerId, json(doc), json(summarize(doc)), name.trim() || 'Untitled design'));
  }

  async duplicate(ownerId: string, id: string): Promise<Design> {
    const src = await this.get(ownerId, id);
    const row = await this.repo.create(ownerId, `${src.name} (copy)`, json(src.doc), json(summarize(src.doc)));
    return toDesign(row);
  }

  async update(ownerId: string, id: string, input: UpdateDesignInput): Promise<UpdateDesignResult> {
    if (input.doc) this.assertValidDoc(input.doc);
    const data: { name?: string; doc?: Prisma.InputJsonValue; summary?: Prisma.InputJsonValue } = {};
    if (input.name !== undefined) data.name = input.name.trim() || 'Untitled design';
    if (input.doc) { data.doc = json(input.doc); data.summary = json(summarize(input.doc)); }

    const res = await this.repo.updateIfRevision(id, ownerId, input.revision, data);
    if (res) return { revision: res.revision, updatedAt: res.updatedAt.toISOString() };
    if (!(await this.repo.exists(id, ownerId))) throw new NotFoundException('Design not found');
    throw new ConflictException('Design was changed elsewhere. Reload to get the latest version.');
  }

  async replaceDoc(ownerId: string, id: string, doc: DesignDoc): Promise<Design> {
    return toDesign(await this.repo.replaceDoc(id, ownerId, json(doc), json(summarize(doc))));
  }

  async setShare(ownerId: string, id: string, enabled: boolean): Promise<ShareState> {
    const current = await this.get(ownerId, id);
    const token = enabled ? current.shareToken ?? randomBytes(12).toString('base64url') : current.shareToken;
    return this.repo.setShare(id, ownerId, enabled, token);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    if (!(await this.repo.delete(id, ownerId))) throw new NotFoundException('Design not found');
  }

  /** Cheap structural guard; the editor is the only writer, this keeps bad clients out. */
  private assertValidDoc(doc: DesignDoc) {
    const arrays = ['nodes', 'edges', 'groups', 'notes', 'flows'] as const;
    if (doc.schemaVersion !== 1) throw new BadRequestException('Unsupported schemaVersion');
    for (const key of arrays) {
      if (!Array.isArray(doc[key])) throw new BadRequestException(`doc.${key} must be an array`);
      if (doc[key].length > LIMITS[key]) throw new BadRequestException(`Too many ${key} (max ${LIMITS[key]})`);
    }
    if (typeof doc.users !== 'number' || doc.users < 0) throw new BadRequestException('doc.users must be a positive number');
    if (!doc.requirements || typeof doc.requirements !== 'object') throw new BadRequestException('doc.requirements is required');
    const ids = new Set(doc.nodes.map((n) => n.id));
    if (ids.size !== doc.nodes.length) throw new BadRequestException('Duplicate node ids');
    for (const e of doc.edges) if (!ids.has(e.from) || !ids.has(e.to)) throw new BadRequestException(`Edge ${e.id} points to a missing node`);
  }
}
