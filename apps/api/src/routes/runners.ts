import type { FastifyInstance } from 'fastify';
import {
  createRunnerPoolSchema,
  Permission,
  QUEUE_NAMES,
  type RunnerJob,
} from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toRunnerPoolDTO, toRunnerDTO } from '../lib/dto.js';

async function poolWithWorkspace(prisma: import('@yourstack/db').PrismaClient, id: string) {
  const pool = await prisma.runnerPool.findFirst({ where: { id, deletedAt: null }, include: { runners: true } });
  if (!pool) throw Errors.notFound('Runner pool not found');
  return pool;
}

export default async function runnerRoutes(app: FastifyInstance) {
  const { prisma, queues, audit } = app.ctx;

  app.get('/workspaces/:wid/runner-pools', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.RUNNER_VIEW);
    const pools = await prisma.runnerPool.findMany({
      where: { workspaceId: wid, deletedAt: null },
      include: { runners: true },
      orderBy: { createdAt: 'desc' },
    });
    return { pools: pools.map(toRunnerPoolDTO) };
  });

  app.post('/workspaces/:wid/runner-pools', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.RUNNER_WRITE);
    const body = parse(createRunnerPoolSchema, req.body);
    const pool = await prisma.runnerPool.create({
      data: {
        workspaceId: wid,
        name: body.name,
        githubScope: body.githubScope,
        labels: body.labels,
        minRunners: body.minRunners,
        maxRunners: body.maxRunners,
        createdById: req.user!.id,
      },
      include: { runners: true },
    });
    if (body.minRunners > 0) {
      const job: RunnerJob = { poolId: pool.id, action: 'scale', desired: body.minRunners };
      await queues.runner.add(QUEUE_NAMES.RUNNER, job, { removeOnComplete: 200 });
    }
    await audit({
      workspaceId: wid,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'runner_pool.create',
      targetType: 'runner_pool',
      targetId: pool.id,
    });
    return { pool: toRunnerPoolDTO(pool) };
  });

  app.get('/runner-pools/:id', async (req) => {
    const { id } = req.params as { id: string };
    const pool = await poolWithWorkspace(prisma, id);
    await requirePermission(prisma, req, pool.workspaceId, Permission.RUNNER_VIEW);
    return { pool: toRunnerPoolDTO(pool) };
  });

  app.get('/runner-pools/:id/runners', async (req) => {
    const { id } = req.params as { id: string };
    const pool = await poolWithWorkspace(prisma, id);
    await requirePermission(prisma, req, pool.workspaceId, Permission.RUNNER_VIEW);
    return { runners: pool.runners.map(toRunnerDTO) };
  });

  app.delete('/runner-pools/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pool = await poolWithWorkspace(prisma, id);
    await requirePermission(prisma, req, pool.workspaceId, Permission.RUNNER_WRITE);
    const job: RunnerJob = { poolId: id, action: 'scale', desired: 0 };
    await queues.runner.add(QUEUE_NAMES.RUNNER, job, { removeOnComplete: 200 });
    await prisma.runnerPool.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      workspaceId: pool.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'runner_pool.delete',
      targetType: 'runner_pool',
      targetId: id,
    });
    reply.status(204).send();
  });
}
