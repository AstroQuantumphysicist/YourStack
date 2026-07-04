import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metricQuerySchema, Permission } from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { queryMetrics } from '../services/metrics.service.js';

/**
 * Resource metrics query API (RAM/CPU/requests/latency/… time series). Powers
 * the dashboard's "worker load" inspection. Authorizes the target against the
 * caller's workspace before returning any series.
 */
export default async function metricsQueryRoutes(app: FastifyInstance) {
  const { prisma } = app.ctx;

  app.get('/metrics', async (req) => {
    const q = parse(metricQuerySchema, req.query);
    await authorizeTarget(prisma, req, q.scope, q.targetId);
    const series = await queryMetrics(prisma, {
      scope: q.scope,
      targetId: q.targetId,
      kinds: q.kinds,
      windowSeconds: q.windowSeconds,
    });
    return { scope: q.scope, targetId: q.targetId, stepSeconds: q.stepSeconds, series };
  });
}

async function authorizeTarget(
  prisma: import('@yourstack/db').PrismaClient,
  req: FastifyRequest,
  scope: string,
  targetId: string,
): Promise<void> {
  let workspaceId: string | undefined;
  switch (scope) {
    case 'node': {
      const n = await prisma.node.findFirst({ where: { id: targetId, deletedAt: null } });
      workspaceId = n?.workspaceId;
      break;
    }
    case 'app': {
      const a = await prisma.app.findFirst({ where: { id: targetId, deletedAt: null }, include: { project: true } });
      workspaceId = a?.project.workspaceId;
      break;
    }
    case 'database': {
      const d = await prisma.managedDatabase.findFirst({ where: { id: targetId }, include: { project: true } });
      workspaceId = d?.project.workspaceId;
      break;
    }
    case 'function': {
      const f = await prisma.serverlessFunction.findFirst({ where: { id: targetId }, include: { project: true } });
      workspaceId = f?.project.workspaceId;
      break;
    }
    default:
      throw Errors.badRequest('Unknown metric scope');
  }
  if (!workspaceId) throw Errors.notFound('Metric target not found');
  await requirePermission(prisma, req, workspaceId, Permission.METRICS_VIEW);
}
