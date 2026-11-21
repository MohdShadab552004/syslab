import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildTemplate, summarize } from '@syslab/sim';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const email = process.env.DEV_USER_EMAIL ?? 'dev@syslab.local';
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name: 'Dev User' } });
  const existing = await prisma.design.count({ where: { ownerId: user.id } });
  if (existing > 0) return console.log(`Seed skipped: ${existing} designs already exist`);
  for (const key of ['ecom', 'lesson'] as const) {
    const t = buildTemplate(key);
    await prisma.design.create({ data: { ownerId: user.id, name: t.name, doc: t.doc as object, summary: summarize(t.doc) as object } });
  }
  console.log('Seeded dev user and 2 designs');
}

main().finally(() => prisma.$disconnect());
