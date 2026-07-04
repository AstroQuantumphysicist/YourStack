import type { FastifyInstance } from 'fastify';
import { createSecretSchema, updateSecretSchema, Permission } from '@noderail/shared';
import { AuditAction } from '@noderail/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toSecretDTO } from '../lib/dto.js';

/** Resolve the workspace that owns a secret's scope target. */
async function resolveScopeWorkspace(
  prisma: import('@noderail/db').PrismaClient,
  input: { scope: string; projectId?: string; appId?: string; environmentId?: string },
): Promise<{ workspaceId: string; projectId: string | null; appId: string | null }> {
  if (input.scope === 'project') {
    if (!input.projectId) throw Errors.badRequest('projectId required for project-scoped secret');
    const p = await prisma.project.findFirst({ where: { id: input.projectId, deletedAt: null } });
    if (!p) throw Errors.notFound('Project not found');
    return { workspaceId: p.workspaceId, projectId: p.id, appId: null };
  }
  if (input.scope === 'app') {
    if (!input.appId) throw Errors.badRequest('appId required for app-scoped secret');
    const a = await prisma.app.findFirst({ where: { id: input.appId, deletedAt: null }, include: { project: true } });
    if (!a) throw Errors.notFound('App not found');
    return { workspaceId: a.project.workspaceId, projectId: a.projectId, appId: a.id };
  }
  if (!input.environmentId) throw Errors.badRequest('environmentId required for environment-scoped secret');
  const e = await prisma.appEnvironment.findFirst({
    where: { id: input.environmentId },
    include: { app: { include: { project: true } } },
  });
  if (!e) throw Errors.notFound('Environment not found');
  return { workspaceId: e.app.project.workspaceId, projectId: e.app.projectId, appId: e.appId };
}

export default async function secretRoutes(app: FastifyInstance) {
  const { prisma, encryptor, audit } = app.ctx;

  // List secrets for a scope target (values never included).
  app.get('/secrets', async (req) => {
    const q = req.query as { projectId?: string; appId?: string; environmentId?: string };
    const scope = q.appId ? 'app' : q.environmentId ? 'environment' : 'project';
    const { workspaceId } = await resolveScopeWorkspace(prisma, { scope, ...q });
    await requirePermission(prisma, req, workspaceId, Permission.SECRET_VIEW);
    const secrets = await prisma.secret.findMany({
      where: {
        projectId: q.projectId ?? undefined,
        appId: q.appId ?? undefined,
        environmentId: q.environmentId ?? undefined,
      },
      orderBy: { key: 'asc' },
    });
    return { secrets: secrets.map(toSecretDTO) };
  });

  app.post('/secrets', async (req) => {
    const body = parse(createSecretSchema, req.body);
    const target = await resolveScopeWorkspace(prisma, body);
    await requirePermission(prisma, req, target.workspaceId, Permission.SECRET_WRITE);

    const ciphertext = encryptor.encrypt(body.value);
    const lastFour = body.value.length >= 4 ? body.value.slice(-4) : null;
    const secret = await prisma.secret.upsert({
      where: {
        scope_projectId_appId_environmentId_key: {
          scope: body.scope,
          projectId: body.projectId ?? '',
          appId: body.appId ?? '',
          environmentId: body.environmentId ?? '',
          key: body.key,
        },
      },
      create: {
        scope: body.scope,
        key: body.key,
        ciphertext,
        lastFour,
        projectId: body.projectId ?? null,
        appId: body.appId ?? null,
        environmentId: body.environmentId ?? null,
        createdById: req.user!.id,
      },
      update: { ciphertext, lastFour },
    });
    await audit({
      workspaceId: target.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.SECRET_CREATE,
      targetType: 'secret',
      targetId: secret.id,
      metadata: { key: body.key, scope: body.scope },
    });
    return { secret: toSecretDTO(secret) };
  });

  app.patch('/secrets/:id', async (req) => {
    const { id } = req.params as { id: string };
    const secret = await prisma.secret.findUnique({ where: { id } });
    if (!secret) throw Errors.notFound('Secret not found');
    const { workspaceId } = await resolveScopeWorkspace(prisma, {
      scope: secret.scope,
      projectId: secret.projectId ?? undefined,
      appId: secret.appId ?? undefined,
      environmentId: secret.environmentId ?? undefined,
    });
    await requirePermission(prisma, req, workspaceId, Permission.SECRET_WRITE);
    const body = parse(updateSecretSchema, req.body);
    const updated = await prisma.secret.update({
      where: { id },
      data: {
        ciphertext: encryptor.encrypt(body.value),
        lastFour: body.value.length >= 4 ? body.value.slice(-4) : null,
      },
    });
    await audit({ workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.SECRET_UPDATE, targetType: 'secret', targetId: id });
    return { secret: toSecretDTO(updated) };
  });

  app.delete('/secrets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const secret = await prisma.secret.findUnique({ where: { id } });
    if (!secret) throw Errors.notFound('Secret not found');
    const { workspaceId } = await resolveScopeWorkspace(prisma, {
      scope: secret.scope,
      projectId: secret.projectId ?? undefined,
      appId: secret.appId ?? undefined,
      environmentId: secret.environmentId ?? undefined,
    });
    await requirePermission(prisma, req, workspaceId, Permission.SECRET_DELETE);
    await prisma.secret.delete({ where: { id } });
    await audit({ workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.SECRET_DELETE, targetType: 'secret', targetId: id });
    reply.status(204).send();
  });
}
