import type { FastifyInstance } from 'fastify';
import {
  createFunctionSchema,
  CommandType,
  Permission,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type FunctionJob,
} from '@yourstack/shared';
import { z } from 'zod';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toFunctionDTO } from '../lib/dto.js';
import { pickNode } from '../services/placement.service.js';
import { createCommand } from '../services/command.service.js';

async function fnWithWorkspace(prisma: import('@yourstack/db').PrismaClient, id: string) {
  const fn = await prisma.serverlessFunction.findFirst({
    where: { id, deletedAt: null },
    include: { project: true },
  });
  if (!fn) throw Errors.notFound('Function not found');
  return { fn, workspaceId: fn.project.workspaceId };
}

export default async function functionRoutes(app: FastifyInstance) {
  const { prisma, queues, audit, realtime } = app.ctx;

  app.get('/projects/:pid/functions', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.FUNCTION_VIEW);
    const since = new Date(Date.now() - 24 * 3600_000);
    const functions = await prisma.serverlessFunction.findMany({
      where: { projectId: pid, deletedAt: null },
      include: { _count: { select: { invocations: { where: { createdAt: { gte: since } } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return { functions: functions.map(toFunctionDTO) };
  });

  app.post('/projects/:pid/functions', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.FUNCTION_WRITE);
    const body = parse(createFunctionSchema.omit({ projectId: true }), req.body);

    const nodeId = await pickNode(prisma, project.workspaceId, { nodeId: body.nodeId, region: body.region });
    const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });

    const fn = await prisma.serverlessFunction.create({
      data: {
        projectId: pid,
        nodeId,
        name: body.name,
        runtime: body.runtime,
        status: 'deploying',
        handler: body.handler,
        region: node.region ?? body.region ?? null,
        memoryMb: body.memoryMb,
        timeoutMs: body.timeoutMs,
        minInstances: body.minInstances,
        repoUrl: body.repoUrl ?? null,
        branch: body.branch ?? null,
        createdById: req.user!.id,
      },
    });
    // The worker builds the function source from the linked git repo/branch, or a
    // runtime-specific starter template when no repo is set.
    const job: FunctionJob = { functionId: fn.id, action: 'deploy', triggeredBy: req.user!.email };
    await queues.fn.add(QUEUE_NAMES.FUNCTION, job, { jobId: `fn-${fn.id}`, removeOnComplete: 200 });
    await realtime.publish(SSE_CHANNELS.workspace(project.workspaceId), 'function.created', { functionId: fn.id });
    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'function.create',
      targetType: 'function',
      targetId: fn.id,
      metadata: { runtime: body.runtime },
    });
    return { function: toFunctionDTO(fn) };
  });

  app.get('/functions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { fn, workspaceId } = await fnWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.FUNCTION_VIEW);
    return { function: toFunctionDTO(fn) };
  });

  app.post('/functions/:id/invoke', async (req) => {
    const { id } = req.params as { id: string };
    const { fn, workspaceId } = await fnWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.FUNCTION_INVOKE);
    if (!fn.nodeId || !fn.containerName) throw Errors.badRequest('Function is not deployed yet');
    const body = parse(z.object({ payload: z.record(z.string(), z.unknown()).default({}) }), req.body ?? {});
    const cmd = await createCommand(prisma, realtime, {
      nodeId: fn.nodeId,
      appId: fn.id,
      payload: {
        type: CommandType.INVOKE_FUNCTION,
        spec: { functionId: fn.id, containerName: fn.containerName, payload: body.payload },
      },
    });
    return { commandId: cmd.id };
  });

  app.get('/functions/:id/invocations', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await fnWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.FUNCTION_VIEW);
    const invocations = await prisma.functionInvocation.findMany({
      where: { functionId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      invocations: invocations.map((i) => ({
        id: i.id,
        status: i.status,
        durationMs: i.durationMs,
        statusCode: i.statusCode,
        timestamp: i.createdAt.toISOString(),
      })),
    };
  });

  app.delete('/functions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { fn, workspaceId } = await fnWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.FUNCTION_DELETE);
    await prisma.serverlessFunction.update({ where: { id }, data: { deletedAt: new Date() } });
    const job: FunctionJob = { functionId: fn.id, action: 'remove', triggeredBy: req.user!.email };
    await queues.fn.add(QUEUE_NAMES.FUNCTION, job, { removeOnComplete: 200 });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'function.delete',
      targetType: 'function',
      targetId: id,
    });
    reply.status(204).send();
  });
}
