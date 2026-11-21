import { Injectable, NotFoundException } from '@nestjs/common';
import type { Design, DesignDoc, DesignVersion } from '@syslab/types';
import type { Prisma } from '../generated/prisma/client';
import { DesignsService } from '../designs/designs.service';
import { VersionsRepository } from './versions.repository';

const toVersion = (r: { id: string; name: string; note: string; createdAt: Date }): DesignVersion => ({
  id: r.id, name: r.name, note: r.note, createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class VersionsService {
  constructor(private readonly repo: VersionsRepository, private readonly designs: DesignsService) {}

  async list(ownerId: string, designId: string): Promise<DesignVersion[]> {
    return (await this.repo.list(designId, ownerId)).map(toVersion);
  }

  /** Snapshots the design as currently saved on the server. */
  async create(ownerId: string, designId: string, name?: string): Promise<DesignVersion> {
    const design = await this.designs.get(ownerId, designId);
    const n = await this.repo.count(designId);
    const note = `${design.doc.nodes.length} components · ${design.doc.edges.length} links`;
    return toVersion(await this.repo.create(designId, name?.trim() || `v${n + 1}`, note, design.doc as unknown as Prisma.InputJsonValue));
  }

  async restore(ownerId: string, designId: string, versionId: string): Promise<Design> {
    const v = await this.repo.findSnapshot(versionId, designId, ownerId);
    if (!v) throw new NotFoundException('Version not found');
    return this.designs.replaceDoc(ownerId, designId, v.snapshot as unknown as DesignDoc);
  }
}
