import type { FastifyInstance } from 'fastify';
import {
  createJoinTokenSchema,
  updateNodeSchema,
  nodeLabelSchema,
  Permission,
  JOIN_TOKEN_TTL_MS,
} from '@yourstack/shared';
import { generateJoinToken, AuditAction } from '@yourstack/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toNodeDTO } from '../lib/dto.js';

async function nodeWorkspace(prisma: import('@yourstack/db').PrismaClient, nodeId: string) {
  const node = await prisma.node.findFirst({ where: { id: nodeId, deletedAt: null } });
  if (!node) throw Errors.notFound('Node not found');
  return node;
}

export default async function nodeRoutes(app: FastifyInstance) {
  const { prisma, config, audit } = app.ctx;

  app.get('/workspaces/:wid/nodes', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.NODE_VIEW);
    const nodes = await prisma.node.findMany({
      where: { workspaceId: wid, deletedAt: null },
      include: { labels: true, _count: { select: { apps: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { nodes: nodes.map(toNodeDTO) };
  });

  // --- Create one-time join token ---
  app.post('/workspaces/:wid/nodes/join-token', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.NODE_JOIN);
    const body = parse(createJoinTokenSchema, req.body ?? {});

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: wid },
      include: { plan: true },
    });
    const nodeCount = await prisma.node.count({ where: { workspaceId: wid, deletedAt: null } });
    if (nodeCount >= workspace.plan.maxNodes) {
      throw Errors.planLimit(`Node limit reached (${workspace.plan.maxNodes}). Upgrade your plan.`);
    }

    const token = generateJoinToken();
    const expiresAt = new Date(Date.now() + JOIN_TOKEN_TTL_MS);
    await prisma.nodeJoinToken.create({
      data: {
        workspaceId: wid,
        tokenHash: token.hash,
        label: body.label ?? null,
        region: body.region ?? null,
        createdById: req.user!.id,
        expiresAt,
      },
    });
    await audit({
      workspaceId: wid,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.NODE_JOIN_TOKEN_CREATE,
    });

    // The token is shown exactly once; agent uses it with `yourstack node join`.
    return {
      joinToken: token.plaintext,
      expiresAt: expiresAt.toISOString(),
      apiUrl: config.PUBLIC_API_URL,
      installCommand: `curl -fsSL ${config.PUBLIC_WEB_URL}/install.sh | YOURSTACK_API_URL="${config.PUBLIC_API_URL}" YOURSTACK_JOIN_TOKEN="${token.plaintext}" sh`,
    };
  });

  app.get('/nodes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const node = await prisma.node.findFirst({
      where: { id, deletedAt: null },
      include: { labels: true, _count: { select: { apps: true } } },
    });
    if (!node) throw Errors.notFound('Node not found');
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_VIEW);
    return { node: toNodeDTO(node) };
  });

  app.get('/nodes/:id/apps', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_VIEW);
    const apps = await prisma.app.findMany({
      where: { nodeId: id, deletedAt: null },
      select: { id: true, name: true, slug: true, status: true, projectId: true },
    });
    return { apps };
  });

  app.get('/nodes/:id/heartbeats', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_VIEW);
    const beats = await prisma.nodeHeartbeat.findMany({
      where: { nodeId: id },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    return {
      heartbeats: beats.reverse().map((b) => ({
        cpuUsagePercent: b.cpuUsagePercent,
        memoryUsedMb: b.memoryUsedMb,
        diskUsedMb: b.diskUsedMb,
        runningApps: b.runningApps,
        timestamp: b.createdAt.toISOString(),
      })),
    };
  });

  app.patch('/nodes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_UPDATE);
    const body = parse(updateNodeSchema, req.body);
    const updated = await prisma.node.update({
      where: { id },
      data: { name: body.name, region: body.region },
      include: { labels: true, _count: { select: { apps: true } } },
    });
    return { node: toNodeDTO(updated) };
  });

  app.post('/nodes/:id/labels', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_UPDATE);
    const body = parse(nodeLabelSchema, req.body);
    await prisma.nodeLabel.upsert({
      where: { nodeId_key: { nodeId: id, key: body.key } },
      create: { nodeId: id, key: body.key, value: body.value },
      update: { value: body.value },
    });
    const updated = await prisma.node.findUniqueOrThrow({
      where: { id },
      include: { labels: true, _count: { select: { apps: true } } },
    });
    return { node: toNodeDTO(updated) };
  });

  app.delete('/nodes/:id/labels/:key', async (req, reply) => {
    const { id, key } = req.params as { id: string; key: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_UPDATE);
    await prisma.nodeLabel.deleteMany({ where: { nodeId: id, key } });
    reply.status(204).send();
  });

  // --- Drain (stop scheduling new apps; instruct agent to converge) ---
  app.post('/nodes/:id/drain', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_DRAIN);
    const updated = await prisma.node.update({
      where: { id },
      data: { status: 'draining' },
      include: { labels: true, _count: { select: { apps: true } } },
    });
    await audit({ workspaceId: node.workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.NODE_DRAIN, targetType: 'node', targetId: id });
    return { node: toNodeDTO(updated) };
  });

  // --- Remove ---
  app.delete('/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = await nodeWorkspace(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_REMOVE);
    await prisma.$transaction([
      prisma.app.updateMany({ where: { nodeId: id }, data: { nodeId: null } }),
      prisma.node.update({ where: { id }, data: { deletedAt: new Date(), status: 'offline', agentTokenHash: null } }),
    ]);
    await audit({ workspaceId: node.workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.NODE_REMOVE, targetType: 'node', targetId: id });
    reply.status(204).send();
  });
}
