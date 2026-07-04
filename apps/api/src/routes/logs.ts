import type { FastifyInstance } from 'fastify';
import { logQuerySchema, Permission } from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';

async function appWorkspaceId(prisma: import('@yourstack/db').PrismaClient, appId: string): Promise<string> {
  const app = await prisma.app.findFirst({ where: { id: appId, deletedAt: null }, include: { project: true } });
  if (!app) throw Errors.notFound('App not found');
  return app.project.workspaceId;
}

export default async function logRoutes(app: FastifyInstance) {
  const { prisma } = app.ctx;

  // Query stored runtime logs with filters.
  app.get('/apps/:id/logs', async (req) => {
    const { id } = req.params as { id: string };
    const workspaceId = await appWorkspaceId(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.LOG_VIEW);
    const q = parse(logQuerySchema, req.query);

    const logs = await prisma.runtimeLog.findMany({
      where: {
        appId: id,
        severity: q.severity ?? undefined,
        message: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
        createdAt: {
          gte: q.since ? new Date(q.since) : undefined,
          lte: q.until ? new Date(q.until) : undefined,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return {
      logs: logs.reverse().map((l) => ({
        id: l.id,
        severity: l.severity,
        message: l.message,
        timestamp: l.createdAt.toISOString(),
      })),
    };
  });
}
