import type { FastifyInstance } from 'fastify';
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
  Permission,
  type WorkspaceRole,
} from '@yourstack/shared';
import { AuditAction } from '@yourstack/security';
import { requireUser } from '../lib/auth.js';
import { requirePermission, resolveMembership } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { slugify, todayKey } from '../lib/util.js';
import { toMemberDTO, toWorkspaceDTO } from '../lib/dto.js';

export default async function workspaceRoutes(app: FastifyInstance) {
  const { prisma, audit } = app.ctx;

  app.post('/workspaces', async (req) => {
    const user = requireUser(req);
    const body = parse(createWorkspaceSchema, req.body);
    const slug = await uniqueSlug(prisma, body.slug ?? slugify(body.name));

    const workspace = await prisma.workspace.create({
      data: {
        name: body.name,
        slug,
        planKey: 'dev',
        members: { create: { userId: user.id, role: 'owner' } },
      },
    });
    await audit({
      workspaceId: workspace.id,
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.WORKSPACE_CREATE,
      targetType: 'workspace',
      targetId: workspace.id,
      ip: req.ip,
    });
    return { workspace: toWorkspaceDTO(workspace, 'owner') };
  });

  app.get('/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    const membership = await resolveMembership(prisma, req, id);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id } });
    return { workspace: toWorkspaceDTO(workspace, membership.role) };
  });

  app.patch('/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    const membership = await requirePermission(prisma, req, id, Permission.WORKSPACE_UPDATE);
    const body = parse(updateWorkspaceSchema, req.body);
    const workspace = await prisma.workspace.update({ where: { id }, data: { name: body.name } });
    await audit({
      workspaceId: id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.WORKSPACE_UPDATE,
      targetType: 'workspace',
      targetId: id,
    });
    return { workspace: toWorkspaceDTO(workspace, membership.role) };
  });

  app.get('/workspaces/:id/stats', async (req) => {
    const { id } = req.params as { id: string };
    await requirePermission(prisma, req, id, Permission.WORKSPACE_VIEW);

    const wsProject = { project: { workspaceId: id } };
    const [apps, nodes, onlineNodes, runningApps, deployments, deploymentsToday, databases, buckets, functions, runners] =
      await Promise.all([
        prisma.app.count({ where: { ...wsProject, deletedAt: null } }),
        prisma.node.count({ where: { workspaceId: id, deletedAt: null } }),
        prisma.node.count({ where: { workspaceId: id, deletedAt: null, status: 'online' } }),
        prisma.app.count({ where: { ...wsProject, deletedAt: null, status: 'running' } }),
        prisma.deployment.count({ where: { app: wsProject } }),
        prisma.usageRecord.findUnique({
          where: { workspaceId_metric_day: { workspaceId: id, metric: 'deployments', day: todayKey() } },
        }),
        prisma.managedDatabase.count({ where: { ...wsProject, deletedAt: null } }),
        prisma.storageBucket.count({ where: { ...wsProject, deletedAt: null } }),
        prisma.serverlessFunction.count({ where: { ...wsProject, deletedAt: null } }),
        prisma.runner.count({ where: { pool: { workspaceId: id }, status: { not: 'offline' } } }),
      ]);

    return {
      stats: {
        apps,
        nodes,
        onlineNodes,
        runningApps,
        deployments,
        deploymentsToday: deploymentsToday?.quantity ?? 0,
        databases,
        buckets,
        functions,
        runners,
      },
    };
  });

  // --- Members ---
  app.get('/workspaces/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    await requirePermission(prisma, req, id, Permission.MEMBER_VIEW);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return { members: members.map(toMemberDTO) };
  });

  app.post('/workspaces/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    await requirePermission(prisma, req, id, Permission.MEMBER_INVITE);
    const body = parse(inviteMemberSchema, req.body);

    const user = await prisma.user.upsert({
      where: { email: body.email },
      update: {},
      create: { email: body.email, name: body.email.split('@')[0] },
    });
    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId: user.id } },
    });
    if (existing) throw Errors.conflict('User is already a member');

    const member = await prisma.workspaceMember.create({
      data: { workspaceId: id, userId: user.id, role: body.role as WorkspaceRole },
      include: { user: true },
    });
    await audit({
      workspaceId: id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.MEMBER_INVITE,
      targetType: 'user',
      targetId: user.id,
      metadata: { role: body.role },
    });
    return { member: toMemberDTO(member) };
  });

  app.patch('/workspaces/:id/members/:memberId', async (req) => {
    const { id, memberId } = req.params as { id: string; memberId: string };
    await requirePermission(prisma, req, id, Permission.MEMBER_UPDATE_ROLE);
    const body = parse(updateMemberRoleSchema, req.body);

    const member = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: id } });
    if (!member) throw Errors.notFound('Member not found');

    // Guard: don't allow removing the last owner.
    if (member.role === 'owner' && body.role !== 'owner') {
      const owners = await prisma.workspaceMember.count({ where: { workspaceId: id, role: 'owner' } });
      if (owners <= 1) throw Errors.badRequest('A workspace must have at least one owner');
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: body.role as WorkspaceRole },
      include: { user: true },
    });
    await audit({
      workspaceId: id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.MEMBER_ROLE_UPDATE,
      targetType: 'user',
      targetId: member.userId,
      metadata: { role: body.role },
    });
    return { member: toMemberDTO(updated) };
  });

  app.delete('/workspaces/:id/members/:memberId', async (req, reply) => {
    const { id, memberId } = req.params as { id: string; memberId: string };
    await requirePermission(prisma, req, id, Permission.MEMBER_REMOVE);
    const member = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: id } });
    if (!member) throw Errors.notFound('Member not found');
    if (member.role === 'owner') {
      const owners = await prisma.workspaceMember.count({ where: { workspaceId: id, role: 'owner' } });
      if (owners <= 1) throw Errors.badRequest('Cannot remove the last owner');
    }
    await prisma.workspaceMember.delete({ where: { id: memberId } });
    await audit({
      workspaceId: id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.MEMBER_REMOVE,
      targetType: 'user',
      targetId: member.userId,
    });
    reply.status(204).send();
  });
}

async function uniqueSlug(prisma: import('@yourstack/db').PrismaClient, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
