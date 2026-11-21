import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsertByEmail(email: string, name?: string) {
    return this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name },
      select: { id: true, email: true },
    });
  }
}
