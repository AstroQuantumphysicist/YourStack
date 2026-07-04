import type { FastifyInstance } from 'fastify';
import { AuditAction } from '@yourstack/security';
import { requirePlatformAdmin } from '../lib/rbac.js';
import { toAuditDTO } from '../lib/dto.js';
import { Errors } from '../lib/errors.js';

/**
 * Platform admin surface. Guarded by the platform-admin flag (granted via the
 * ADMIN_EMAILS env allowlist). Provides cross-tenant visibility and kill switches.
 */
export default async function adminRoutes(app: FastifyInstance) {
  const { prisma, audit } = app.ctx;

  app.addHook('onRequest', async (req) => {
    requirePlatformAdmin(req);
  });

  app.get('/admin/stats', async () => {
    const [users, workspaces, nodes, onlineNodes, apps, deployments] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count({ where: { deletedAt: null } }),
      prisma.node.count({ where: { deletedAt: null } }),
      prisma.node.count({ where: { deletedAt: null, status: 'online' } }),
      prisma.app.count({ where: { deletedAt: null } }),
      prisma.deployment.count(),
    ]);
    return { stats: { users, workspaces, nodes, onlineNodes, apps, deployments } };
  });

  app.get('/admin/workspaces', async (req) => {
    const q = req.query as { limit?: string };
    const workspaces = await prisma.workspace.findMany({
      include: { _count: { select: { members: true, projects: true, nodes: true } }, plan: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit ?? 100), 500),
    });
    return {
      workspaces: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        status: w.status,
        planKey: w.planKey,
        members: w._count.members,
        projects: w._count.projects,
        nodes: w._count.nodes,
        createdAt: w.createdAt.toISOString(),
      })),
    };
  });

  app.get('/admin/users', async (req) => {
    const q = req.query as { limit?: string };
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit ?? 100), 500),
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isPlatformAdmin: u.isPlatformAdmin,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  });

  app.get('/admin/nodes', async () => {
    const nodes = await prisma.node.findMany({
      where: { deletedAt: null },
      include: { workspace: { select: { slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        status: n.status,
        disabled: n.disabled,
        workspace: n.workspace.slug,
        lastHeartbeatAt: n.lastHeartbeatAt?.toISOString() ?? null,
      })),
    };
  });

  app.get('/admin/audit', async (req) => {
    const q = req.query as { limit?: string };
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit ?? 200), 1000),
    });
    return { logs: logs.map(toAuditDTO) };
  });

  app.post('/admin/workspaces/:id/suspend', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body as { suspend?: boolean }) ?? {};
    const workspace = await prisma.workspace.findFirst({ where: { id, deletedAt: null } });
    if (!workspace) throw Errors.notFound('Workspace not found');
    const updated = await prisma.workspace.update({
      where: { id },
      data: { status: body.suspend === false ? 'active' : 'suspended' },
    });
    await audit({
      workspaceId: id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.ADMIN_WORKSPACE_SUSPEND,
      targetType: 'workspace',
      targetId: id,
      metadata: { status: updated.status },
    });
    return { status: updated.status };
  });

  app.post('/admin/nodes/:id/disable', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body as { disable?: boolean }) ?? {};
    const node = await prisma.node.findFirst({ where: { id, deletedAt: null } });
    if (!node) throw Errors.notFound('Node not found');
    const updated = await prisma.node.update({
      where: { id },
      data: { disabled: body.disable !== false },
    });
    await audit({
      workspaceId: node.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.ADMIN_NODE_DISABLE,
      targetType: 'node',
      targetId: id,
      metadata: { disabled: updated.disabled },
    });
    return { disabled: updated.disabled };
  });
}
