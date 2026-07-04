import type { FastifyInstance } from 'fastify';
import { Permission } from '@noderail/shared';
import { requirePermission } from '../lib/rbac.js';
import { Errors } from '../lib/errors.js';
import { toDeploymentDTO, toPipelineRunDTO } from '../lib/dto.js';

async function deploymentWorkspace(prisma: import('@noderail/db').PrismaClient, deploymentId: string) {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { app: { include: { project: true } } },
  });
  if (!deployment) throw Errors.notFound('Deployment not found');
  return { deployment, workspaceId: deployment.app.project.workspaceId };
}

export default async function deploymentRoutes(app: FastifyInstance) {
  const { prisma } = app.ctx;

  app.get('/apps/:id/deployments', async (req) => {
    const { id } = req.params as { id: string };
    const found = await prisma.app.findFirst({ where: { id, deletedAt: null }, include: { project: true } });
    if (!found) throw Errors.notFound('App not found');
    await requirePermission(prisma, req, found.project.workspaceId, Permission.APP_VIEW);
    const deployments = await prisma.deployment.findMany({
      where: { appId: id },
      orderBy: { version: 'desc' },
      take: 50,
    });
    return { deployments: deployments.map(toDeploymentDTO) };
  });

  app.get('/deployments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { deployment, workspaceId } = await deploymentWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_VIEW);
    const run = await prisma.pipelineRun.findFirst({
      where: { deploymentId: id },
      include: { stages: true },
    });
    return {
      deployment: toDeploymentDTO(deployment),
      pipelineRun: run ? toPipelineRunDTO(run) : null,
    };
  });

  app.get('/deployments/:id/logs', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await deploymentWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.LOG_VIEW);
    const q = req.query as { limit?: string };
    const logs = await prisma.deploymentLog.findMany({
      where: { deploymentId: id },
      orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(Number(q.limit ?? 500), 2000),
    });
    return {
      logs: logs.map((l) => ({
        id: l.id,
        stream: l.stream,
        severity: l.severity,
        message: l.message,
        seq: l.seq,
        timestamp: l.createdAt.toISOString(),
      })),
    };
  });
}
