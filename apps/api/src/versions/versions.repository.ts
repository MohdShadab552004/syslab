import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const listSelect = { id: true, name: true, note: true, createdAt: true } satisfies Prisma.DesignVersionSelect;

@Injectable()
export class VersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ownership is enforced through the parent design. */
  list(designId: string, ownerId: string) {
    return this.prisma.designVersion.findMany({
      where: { designId, design: { ownerId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: listSelect,
    });
  }

  count(designId: string) {
    return this.prisma.designVersion.count({ where: { designId } });
  }

  create(designId: string, name: string, note: string, snapshot: Prisma.InputJsonValue) {
    return this.prisma.designVersion.create({ data: { designId, name, note, snapshot }, select: listSelect });
  }

  findSnapshot(id: string, designId: string, ownerId: string) {
    return this.prisma.designVersion.findFirst({
      where: { id, designId, design: { ownerId } },
      select: { id: true, name: true, snapshot: true },
    });
  }
}
