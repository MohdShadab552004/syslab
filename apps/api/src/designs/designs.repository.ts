import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const designSelect = {
  id: true, name: true, doc: true, revision: true, shareEnabled: true, shareToken: true, createdAt: true, updatedAt: true,
} satisfies Prisma.DesignSelect;

const summarySelect = { id: true, name: true, summary: true, updatedAt: true } satisfies Prisma.DesignSelect;

export type DesignRecord = Prisma.DesignGetPayload<{ select: typeof designSelect }>;
export type DesignSummaryRecord = Prisma.DesignGetPayload<{ select: typeof summarySelect }>;

/** All Design table access. Every query is scoped by owner. */
@Injectable()
export class DesignsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Keyset pagination on (updatedAt desc, id) via Prisma cursor; never loads `doc`. */
  listByOwner(ownerId: string, limit: number, cursor?: string): Promise<DesignSummaryRecord[]> {
    return this.prisma.design.findMany({
      where: { ownerId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: summarySelect,
    });
  }

  findOwned(id: string, ownerId: string): Promise<DesignRecord | null> {
    return this.prisma.design.findFirst({ where: { id, ownerId }, select: designSelect });
  }

  exists(id: string, ownerId: string): Promise<boolean> {
    return this.prisma.design.count({ where: { id, ownerId } }).then((c) => c > 0);
  }

  findShared(token: string): Promise<DesignRecord | null> {
    return this.prisma.design.findFirst({ where: { shareToken: token, shareEnabled: true }, select: designSelect });
  }

  create(ownerId: string, name: string, doc: Prisma.InputJsonValue, summary: Prisma.InputJsonValue): Promise<DesignRecord> {
    return this.prisma.design.create({ data: { ownerId, name, doc, summary }, select: designSelect });
  }

  /**
   * Compare-and-set update: succeeds only if the stored revision still matches.
   * Returns null on a revision mismatch or missing row (caller tells them apart).
   */
  async updateIfRevision(
    id: string,
    ownerId: string,
    revision: number,
    data: { name?: string; doc?: Prisma.InputJsonValue; summary?: Prisma.InputJsonValue },
  ): Promise<{ revision: number; updatedAt: Date } | null> {
    const res = await this.prisma.design.updateMany({
      where: { id, ownerId, revision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (res.count === 0) return null;
    return { revision: revision + 1, updatedAt: new Date() };
  }

  /** Unconditional doc replace (used by version restore). */
  replaceDoc(id: string, ownerId: string, doc: Prisma.InputJsonValue, summary: Prisma.InputJsonValue): Promise<DesignRecord> {
    return this.prisma.design.update({
      where: { id, ownerId },
      data: { doc, summary, revision: { increment: 1 } },
      select: designSelect,
    });
  }

  setShare(id: string, ownerId: string, shareEnabled: boolean, shareToken: string | null) {
    return this.prisma.design.update({
      where: { id, ownerId },
      data: { shareEnabled, shareToken },
      select: { shareEnabled: true, shareToken: true },
    });
  }

  delete(id: string, ownerId: string) {
    return this.prisma.design.deleteMany({ where: { id, ownerId } }).then((r) => r.count > 0);
  }
}
