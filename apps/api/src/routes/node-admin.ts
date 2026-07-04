import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import {
  nodeActionSchema,
  Permission,
  QUEUE_NAMES,
  type NodeAdminJob,
} from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toCommandDTO } from '../lib/dto.js';

async function nodeById(prisma: PrismaClient, id: string) {
  const node = await prisma.node.findFirst({ where: { id, deletedAt: null } });
  if (!node) throw Errors.notFound('Node not found');
  return node;
}

export default async function nodeAdminRoutes(app: FastifyInstance) {
  const { prisma, queues, audit } = app.ctx;

  // Enqueue a node-administration action. The worker resolves it into a signed,
  // typed node command (NODE_REBOOT / DOCKER_PRUNE / AGENT_UPDATE) and dispatches it.
  app.post('/nodes/:id/actions', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeById(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_ADMIN);
    const body = parse(nodeActionSchema, req.body);

    const job: NodeAdminJob = { nodeId: id, action: body.action, version: body.version };
    await queues.nodeAdmin.add(QUEUE_NAMES.NODE_ADMIN, job, { removeOnComplete: 200 });
    await audit({
      workspaceId: node.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: `node.action.${body.action}`,
      targetType: 'node',
      targetId: id,
      metadata: body.version ? { version: body.version } : undefined,
    });
    return { ok: true, action: body.action };
  });

  app.get('/nodes/:id/commands', async (req) => {
    const { id } = req.params as { id: string };
    const node = await nodeById(prisma, id);
    await requirePermission(prisma, req, node.workspaceId, Permission.NODE_VIEW);
    const commands = await prisma.nodeCommand.findMany({
      where: { nodeId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { commands: commands.map(toCommandDTO) };
  });
}
