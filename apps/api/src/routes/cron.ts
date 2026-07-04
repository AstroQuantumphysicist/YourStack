import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import {
  createCronJobSchema,
  updateCronJobSchema,
  CronJobStatus,
  Permission,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type CronJob as CronJobPayload,
} from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { iso } from '../lib/util.js';
import { toCronJobDTO } from '../lib/dto.js';
import { pickNode } from '../services/placement.service.js';

/** Resolve the workspace that owns a cron job (through its project). */
async function cronWithWorkspace(prisma: PrismaClient, id: string) {
  const cron = await prisma.cronJob.findFirst({
    where: { id, deletedAt: null },
    include: { project: true },
  });
  if (!cron) throw Errors.notFound('Cron job not found');
  return { cron, workspaceId: cron.project.workspaceId };
}

/** Snapshot the project's secrets as the cron container's env (encrypted blob). */
async function resolveProjectEnv(
  prisma: PrismaClient,
  encryptor: import('@yourstack/security').Encryptor,
  projectId: string,
): Promise<Record<string, string>> {
  const secrets = await prisma.secret.findMany({ where: { scope: 'project', projectId } });
  const env: Record<string, string> = {};
  for (const s of secrets) {
    try {
      env[s.key] = encryptor.decrypt(s.ciphertext);
    } catch {
      // Skip undecryptable secrets rather than fail cron creation.
    }
  }
  return env;
}

export default async function cronRoutes(app: FastifyInstance) {
  const { prisma, queues, encryptor, realtime, audit } = app.ctx;

  const enqueue = (cronJobId: string, immediate = false) => {
    const job: CronJobPayload = { cronJobId };
    return queues.cron.add(QUEUE_NAMES.CRON, job, {
      jobId: immediate ? `cron-run-${cronJobId}-${Date.now()}` : `cron-${cronJobId}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  };

  app.get('/projects/:pid/cron', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.CRON_VIEW);
    const jobs = await prisma.cronJob.findMany({
      where: { projectId: pid, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { cronJobs: jobs.map(toCronJobDTO) };
  });

  app.post('/projects/:pid/cron', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.CRON_WRITE);
    const body = parse(createCronJobSchema.omit({ projectId: true }), req.body);

    const nodeId = await pickNode(prisma, project.workspaceId, {
      nodeId: body.nodeId,
      region: body.region,
    });
    const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    const env = await resolveProjectEnv(prisma, encryptor, pid);

    const cron = await prisma.cronJob.create({
      data: {
        projectId: pid,
        nodeId,
        name: body.name,
        schedule: body.schedule,
        image: body.image,
        command: body.command ?? null,
        status: CronJobStatus.ACTIVE,
        region: node.region ?? body.region ?? null,
        cpu: body.cpu,
        memoryMb: body.memoryMb,
        timeoutSeconds: body.timeoutSeconds,
        envCipher: encryptor.encrypt(JSON.stringify(env)),
        createdById: req.user!.id,
      },
    });

    await enqueue(cron.id);
    await realtime.publish(SSE_CHANNELS.workspace(project.workspaceId), 'cron.created', {
      cronJobId: cron.id,
    });
    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'cron.create',
      targetType: 'cron',
      targetId: cron.id,
      metadata: { schedule: cron.schedule, image: cron.image },
    });
    return { cronJob: toCronJobDTO(cron) };
  });

  app.get('/cron/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { cron, workspaceId } = await cronWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.CRON_VIEW);
    return { cronJob: toCronJobDTO(cron) };
  });

  app.patch('/cron/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await cronWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.CRON_WRITE);
    const body = parse(updateCronJobSchema, req.body);

    const status =
      body.paused == null
        ? undefined
        : body.paused
          ? CronJobStatus.PAUSED
          : CronJobStatus.ACTIVE;

    const updated = await prisma.cronJob.update({
      where: { id },
      data: {
        schedule: body.schedule ?? undefined,
        status,
      },
    });
    // Re-enqueue so the worker reconciles the repeatable schedule (or pauses it).
    await enqueue(updated.id);
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'cron.update',
      targetType: 'cron',
      targetId: id,
      metadata: { schedule: updated.schedule, status: updated.status },
    });
    return { cronJob: toCronJobDTO(updated) };
  });

  app.delete('/cron/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await cronWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.CRON_WRITE);
    await prisma.cronJob.update({
      where: { id },
      data: { deletedAt: new Date(), status: CronJobStatus.PAUSED },
    });
    // Ask the worker to drop the repeatable schedule.
    await enqueue(id);
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'cron.delete',
      targetType: 'cron',
      targetId: id,
    });
    reply.status(204).send();
  });

  // Trigger an immediate run.
  app.post('/cron/:id/run', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await cronWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.CRON_WRITE);
    await enqueue(id, true);
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'cron.run',
      targetType: 'cron',
      targetId: id,
    });
    return { ok: true, cronJobId: id };
  });

  // Recent run history.
  app.get('/cron/:id/runs', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await cronWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.CRON_VIEW);
    const runs = await prisma.cronRun.findMany({
      where: { cronJobId: id },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return {
      runs: runs.map((r) => ({
        id: r.id,
        cronJobId: r.cronJobId,
        status: r.status,
        exitCode: r.exitCode,
        durationMs: r.durationMs,
        startedAt: r.startedAt.toISOString(),
        finishedAt: iso(r.finishedAt),
      })),
    };
  });
}
