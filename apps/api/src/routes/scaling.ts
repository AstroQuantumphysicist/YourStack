import type { FastifyInstance } from 'fastify';
import { updateScalingPolicySchema, Permission, QUEUE_NAMES, type AutoscaleJob } from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toScalingPolicyDTO } from '../lib/dto.js';

async function appWorkspace(prisma: import('@yourstack/db').PrismaClient, appId: string) {
  const app = await prisma.app.findFirst({ where: { id: appId, deletedAt: null }, include: { project: true } });
  if (!app) throw Errors.notFound('App not found');
  return { app, workspaceId: app.project.workspaceId };
}

export default async function scalingRoutes(app: FastifyInstance) {
  const { prisma, queues } = app.ctx;

  app.get('/apps/:id/scaling', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.SCALING_VIEW);
    const policy = await prisma.scalingPolicy.findUnique({ where: { appId: id } });
    return { policy: policy ? toScalingPolicyDTO(policy) : null };
  });

  app.put('/apps/:id/scaling', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.SCALING_WRITE);
    const body = parse(updateScalingPolicySchema, req.body);
    if (body.maxReplicas < body.minReplicas) {
      throw Errors.badRequest('maxReplicas must be >= minReplicas');
    }
    const policy = await prisma.scalingPolicy.upsert({
      where: { appId: id },
      create: {
        appId: id,
        enabled: body.enabled,
        minReplicas: body.minReplicas,
        maxReplicas: body.maxReplicas,
        metric: body.metric,
        targetValue: body.targetValue,
        cooldownSeconds: body.cooldownSeconds,
        currentReplicas: body.minReplicas,
      },
      update: {
        enabled: body.enabled,
        minReplicas: body.minReplicas,
        maxReplicas: body.maxReplicas,
        metric: body.metric,
        targetValue: body.targetValue,
        cooldownSeconds: body.cooldownSeconds,
      },
    });
    if (body.enabled) {
      const job: AutoscaleJob = { appId: id };
      await queues.autoscale.add(QUEUE_NAMES.AUTOSCALE, job, {
        repeat: { every: 30_000 },
        jobId: `autoscale-${id}`,
        removeOnComplete: 10,
      });
    } else {
      // Stop the repeatable autoscale evaluation for this app.
      try {
        await queues.autoscale.removeJobScheduler(`autoscale-${id}`);
      } catch {
        /* scheduler may not exist */
      }
    }
    return { policy: toScalingPolicyDTO(policy) };
  });
}
