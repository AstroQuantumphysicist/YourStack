import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. In dev with hot-reload we cache it on globalThis to
 * avoid exhausting connections. Services import { prisma } from '@noderail/db'.
 */
const globalForPrisma = globalThis as unknown as { __noderailPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__noderailPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__noderailPrisma = prisma;
}

export type { PrismaClient } from '@prisma/client';
export * from '@prisma/client';
export { Prisma } from '@prisma/client';
