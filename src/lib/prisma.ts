import { PrismaClient } from '@prisma/client';
import { assertVerificationEnvironment } from '@/lib/evidence-environment';

const entrypoint = process.argv[1]?.split(/[\\/]/).at(-1) ?? '';
if (/^verify(?:-|\.)/.test(entrypoint)) assertVerificationEnvironment(entrypoint);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
