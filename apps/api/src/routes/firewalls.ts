import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import {
  createFirewallSchema,
  updateFirewallSchema,
  Permission,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type FirewallJob,
} from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toFirewallDTO } from '../lib/dto.js';

type FirewallRuleInput = ReturnType<typeof createFirewallSchema.parse>['rules'][number];

const firewallInclude = { rules: true } as const;

function ruleRows(rules: FirewallRuleInput[]) {
  return rules.map((r, position) => ({
    direction: r.direction,
    action: r.action,
    protocol: r.protocol,
    port: r.port ?? null,
    cidr: r.cidr,
    comment: r.comment ?? null,
    position,
  }));
}

async function firewallById(prisma: PrismaClient, id: string) {
  const firewall = await prisma.firewall.findFirst({
    where: { id, deletedAt: null },
    include: firewallInclude,
  });
  if (!firewall) throw Errors.notFound('Firewall not found');
  return firewall;
}

export default async function firewallRoutes(app: FastifyInstance) {
  const { prisma, queues, audit, realtime } = app.ctx;

  app.get('/workspaces/:wid/firewalls', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.FIREWALL_VIEW);
    const firewalls = await prisma.firewall.findMany({
      where: { workspaceId: wid, deletedAt: null },
      include: firewallInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { firewalls: firewalls.map(toFirewallDTO) };
  });

  app.post('/workspaces/:wid/firewalls', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.FIREWALL_WRITE);
    const body = parse(createFirewallSchema, req.body);
    const firewall = await prisma.firewall.create({
      data: {
        workspaceId: wid,
        name: body.name,
        status: 'draft',
        defaultInbound: body.defaultInbound,
        defaultOutbound: body.defaultOutbound,
        nodeIds: body.nodeIds,
        createdById: req.user!.id,
        rules: { create: ruleRows(body.rules) },
      },
      include: firewallInclude,
    });
    await audit({
      workspaceId: wid,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'firewall.create',
      targetType: 'firewall',
      targetId: firewall.id,
    });
    return { firewall: toFirewallDTO(firewall) };
  });

  app.get('/firewalls/:id', async (req) => {
    const { id } = req.params as { id: string };
    const firewall = await firewallById(prisma, id);
    await requirePermission(prisma, req, firewall.workspaceId, Permission.FIREWALL_VIEW);
    return { firewall: toFirewallDTO(firewall) };
  });

  app.patch('/firewalls/:id', async (req) => {
    const { id } = req.params as { id: string };
    const firewall = await firewallById(prisma, id);
    await requirePermission(prisma, req, firewall.workspaceId, Permission.FIREWALL_WRITE);
    const body = parse(updateFirewallSchema, req.body);

    const updated = await prisma.$transaction(async (tx) => {
      // Rules and node targets are replaced wholesale when provided.
      if (body.rules !== undefined) {
        await tx.firewallRule.deleteMany({ where: { firewallId: id } });
      }
      return tx.firewall.update({
        where: { id },
        data: {
          name: body.name,
          defaultInbound: body.defaultInbound,
          defaultOutbound: body.defaultOutbound,
          nodeIds: body.nodeIds,
          ...(body.rules !== undefined ? { rules: { create: ruleRows(body.rules) } } : {}),
        },
        include: firewallInclude,
      });
    });
    return { firewall: toFirewallDTO(updated) };
  });

  app.delete('/firewalls/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const firewall = await firewallById(prisma, id);
    await requirePermission(prisma, req, firewall.workspaceId, Permission.FIREWALL_WRITE);
    await prisma.firewall.update({ where: { id }, data: { deletedAt: new Date() } });
    const job: FirewallJob = { firewallId: id, action: 'remove' };
    await queues.firewall.add(QUEUE_NAMES.FIREWALL, job, { removeOnComplete: 200 });
    await audit({
      workspaceId: firewall.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'firewall.delete',
      targetType: 'firewall',
      targetId: id,
    });
    reply.status(204).send();
  });

  app.post('/firewalls/:id/apply', async (req) => {
    const { id } = req.params as { id: string };
    const firewall = await firewallById(prisma, id);
    await requirePermission(prisma, req, firewall.workspaceId, Permission.FIREWALL_WRITE);
    if (firewall.nodeIds.length === 0) {
      throw Errors.badRequest('Attach at least one node before applying this firewall');
    }
    const updated = await prisma.firewall.update({
      where: { id },
      data: { status: 'applying' },
      include: firewallInclude,
    });
    const job: FirewallJob = { firewallId: id, action: 'apply' };
    await queues.firewall.add(QUEUE_NAMES.FIREWALL, job, { jobId: `fw-${id}`, removeOnComplete: 200 });
    await realtime.publish(SSE_CHANNELS.firewall(id), 'firewall.status', { firewallId: id, status: 'applying' });
    await audit({
      workspaceId: firewall.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'firewall.apply',
      targetType: 'firewall',
      targetId: id,
    });
    return { firewall: toFirewallDTO(updated) };
  });
}
