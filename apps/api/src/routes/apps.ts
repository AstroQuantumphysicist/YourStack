import type { FastifyInstance } from 'fastify';
import {
  createAppSchema,
  updateAppSchema,
  deployAppRequestSchema,
  rollbackRequestSchema,
  Permission,
  QUEUE_NAMES,
  CommandType,
  type RollbackJob,
  type AppFramework,
  type DeploymentStrategy,
} from '@noderail/shared';
import { AuditAction } from '@noderail/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { slugify } from '../lib/util.js';
import { toAppDTO } from '../lib/dto.js';
import { triggerDeployment } from '../services/deployment.service.js';
import { createCommand } from '../services/command.service.js';

/** Resolve the workspace id that owns an app (through project). */
async function appWorkspace(prisma: import('@noderail/db').PrismaClient, appId: string) {
  const app = await prisma.app.findFirst({
    where: { id: appId, deletedAt: null },
    include: { project: true },
  });
  if (!app) throw Errors.notFound('App not found');
  return { app, workspaceId: app.project.workspaceId };
}

export default async function appRoutes(app: FastifyInstance) {
  const { prisma, queues, realtime, audit } = app.ctx;

  app.get('/projects/:pid/apps', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.APP_VIEW);
    const apps = await prisma.app.findMany({
      where: { projectId: pid, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { apps: apps.map(toAppDTO) };
  });

  app.post('/projects/:pid/apps', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({
      where: { id: pid, deletedAt: null },
      include: { workspace: { include: { plan: true } } },
    });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.APP_CREATE);
    const body = parse(createAppSchema.omit({ projectId: true }), req.body);

    // Enforce plan app limit.
    const appCount = await prisma.app.count({
      where: { project: { workspaceId: project.workspaceId }, deletedAt: null },
    });
    if (appCount >= project.workspace.plan.maxApps) {
      throw Errors.planLimit(`App limit reached (${project.workspace.plan.maxApps}). Upgrade your plan.`);
    }

    const slug = body.slug ?? slugify(body.name);
    if (await prisma.app.findUnique({ where: { projectId_slug: { projectId: pid, slug } } })) {
      throw Errors.conflict('An app with that slug already exists in this project');
    }

    const created = await prisma.app.create({
      data: {
        projectId: pid,
        name: body.name,
        slug,
        repoUrl: body.repoUrl ?? null,
        gitRepositoryId: body.gitRepositoryId ?? null,
        branch: body.branch,
        framework: (body.framework as AppFramework | undefined) ?? null,
        installCommand: body.installCommand ?? null,
        buildCommand: body.buildCommand ?? null,
        startCommand: body.startCommand ?? null,
        port: body.port,
        cpu: body.resources?.cpu ?? 0.5,
        memoryMb: body.resources?.memoryMb ?? 512,
        deploymentStrategy: body.deploymentStrategy as DeploymentStrategy,
        healthcheckPath: body.healthcheckPath,
        nodeId: body.nodeId ?? null,
      },
    });
    // Every app gets a default production environment.
    await prisma.appEnvironment.create({
      data: { appId: created.id, name: 'production', type: 'production' },
    });
    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.APP_CREATE,
      targetType: 'app',
      targetId: created.id,
    });
    return { app: toAppDTO(created) };
  });

  app.get('/apps/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { app: found, workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_VIEW);
    return { app: toAppDTO(found) };
  });

  app.patch('/apps/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_UPDATE);
    const body = parse(updateAppSchema, req.body);
    const updated = await prisma.app.update({
      where: { id },
      data: {
        name: body.name,
        repoUrl: body.repoUrl,
        gitRepositoryId: body.gitRepositoryId,
        branch: body.branch,
        framework: body.framework as AppFramework | undefined,
        installCommand: body.installCommand,
        buildCommand: body.buildCommand,
        startCommand: body.startCommand,
        port: body.port,
        cpu: body.resources?.cpu,
        memoryMb: body.resources?.memoryMb,
        deploymentStrategy: body.deploymentStrategy as DeploymentStrategy | undefined,
        healthcheckPath: body.healthcheckPath,
        nodeId: body.nodeId,
      },
    });
    return { app: toAppDTO(updated) };
  });

  app.delete('/apps/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { app: found, workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_DELETE);
    // Best-effort: instruct the node to remove the container.
    if (found.nodeId && found.currentDeploymentId) {
      await createCommand(prisma, realtime, {
        nodeId: found.nodeId,
        appId: found.id,
        payload: {
          type: CommandType.REMOVE_APP,
          spec: { appId: found.id, containerName: `noderail-${found.id}`, removeVolumes: false, removeImages: false },
        },
      }).catch(() => undefined);
    }
    await prisma.app.update({ where: { id }, data: { deletedAt: new Date(), status: 'stopped' } });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.APP_DELETE,
      targetType: 'app',
      targetId: id,
    });
    reply.status(204).send();
  });

  // --- Deploy ---
  app.post('/apps/:id/deploy', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_DEPLOY);
    const body = parse(deployAppRequestSchema, req.body ?? {});
    const result = await triggerDeployment(prisma, queues.deploy, realtime, {
      appId: id,
      triggeredBy: req.user!.email,
      triggeredById: req.user!.id,
      ref: body.ref,
      reason: body.reason,
    });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.APP_DEPLOY,
      targetType: 'app',
      targetId: id,
      metadata: { deploymentId: result.deploymentId, version: result.version },
    });
    return result;
  });

  // --- Restart ---
  app.post('/apps/:id/restart', async (req) => {
    const { id } = req.params as { id: string };
    const { app: found, workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_CONTROL);
    if (!found.nodeId) throw Errors.badRequest('App has no node assigned');
    const cmd = await createCommand(prisma, realtime, {
      nodeId: found.nodeId,
      appId: found.id,
      payload: { type: CommandType.RESTART_APP, spec: { appId: found.id, containerName: `noderail-${found.id}` } },
    });
    await audit({ workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.APP_RESTART, targetType: 'app', targetId: id });
    return { commandId: cmd.id };
  });

  // --- Stop ---
  app.post('/apps/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const { app: found, workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_CONTROL);
    if (!found.nodeId) throw Errors.badRequest('App has no node assigned');
    const cmd = await createCommand(prisma, realtime, {
      nodeId: found.nodeId,
      appId: found.id,
      payload: { type: CommandType.STOP_APP, spec: { appId: found.id, containerName: `noderail-${found.id}`, timeoutSeconds: 10 } },
    });
    await prisma.app.update({ where: { id }, data: { status: 'stopped' } });
    await audit({ workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.APP_STOP, targetType: 'app', targetId: id });
    return { commandId: cmd.id };
  });

  // --- Rollback ---
  app.post('/apps/:id/rollback', async (req) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.APP_ROLLBACK);
    const body = parse(rollbackRequestSchema, req.body);
    const target = await prisma.deployment.findFirst({
      where: { id: body.targetDeploymentId, appId: id },
    });
    if (!target) throw Errors.notFound('Target deployment not found');
    if (!target.specSnapshot) throw Errors.badRequest('Target deployment has no stored spec to roll back to');

    const job: RollbackJob = { appId: id, targetDeploymentId: body.targetDeploymentId, triggeredBy: req.user!.email };
    await queues.rollback.add(QUEUE_NAMES.ROLLBACK, job, { removeOnComplete: 200, removeOnFail: 200 });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.APP_ROLLBACK,
      targetType: 'app',
      targetId: id,
      metadata: { targetDeploymentId: body.targetDeploymentId },
    });
    return { ok: true, targetDeploymentId: body.targetDeploymentId };
  });
}
