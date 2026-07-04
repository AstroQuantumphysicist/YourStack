import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '@noderail/shared';
import { requirePermission } from '../lib/rbac.js';
import { Errors } from '../lib/errors.js';

/**
 * Server-Sent Events stream. Clients connect to `/v1/events?channel=app:<id>`
 * and receive realtime events (deployment status, logs, heartbeats). The channel
 * is authorized against the caller's workspace permissions before streaming.
 */
export default async function eventRoutes(app: FastifyInstance) {
  const { prisma, realtime } = app.ctx;

  app.get('/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const { channel } = req.query as { channel?: string };
    if (!channel) throw Errors.badRequest('channel query param required');
    await authorizeChannel(prisma, req, channel);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: open\ndata: ${JSON.stringify({ channel })}\n\n`);

    const send = (event: { type: string; data: unknown }) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const unsubscribe = realtime.subscribe(channel, (e) => send({ type: e.type, data: e.data }));

    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });

    // Keep the request open; do not return (Fastify won't close the connection).
    return reply;
  });
}

async function authorizeChannel(
  prisma: import('@noderail/db').PrismaClient,
  req: FastifyRequest,
  channel: string,
): Promise<void> {
  const [kind, id] = channel.split(':');
  if (!kind || !id) throw Errors.badRequest('Invalid channel');

  switch (kind) {
    case 'workspace':
      await requirePermission(prisma, req, id, Permission.WORKSPACE_VIEW);
      return;
    case 'node': {
      const node = await prisma.node.findFirst({ where: { id, deletedAt: null } });
      if (!node) throw Errors.notFound('Node not found');
      await requirePermission(prisma, req, node.workspaceId, Permission.NODE_VIEW);
      return;
    }
    case 'app': {
      const a = await prisma.app.findFirst({ where: { id, deletedAt: null }, include: { project: true } });
      if (!a) throw Errors.notFound('App not found');
      await requirePermission(prisma, req, a.project.workspaceId, Permission.LOG_VIEW);
      return;
    }
    case 'deployment': {
      const d = await prisma.deployment.findUnique({ where: { id }, include: { app: { include: { project: true } } } });
      if (!d) throw Errors.notFound('Deployment not found');
      await requirePermission(prisma, req, d.app.project.workspaceId, Permission.LOG_VIEW);
      return;
    }
    case 'pipeline': {
      const p = await prisma.pipelineRun.findUnique({ where: { id }, include: { app: { include: { project: true } } } });
      if (!p) throw Errors.notFound('Pipeline run not found');
      await requirePermission(prisma, req, p.app.project.workspaceId, Permission.PIPELINE_VIEW);
      return;
    }
    default:
      throw Errors.badRequest('Unknown channel kind');
  }
}
