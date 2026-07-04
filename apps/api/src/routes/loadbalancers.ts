import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import {
  createLoadBalancerSchema,
  Permission,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type LBAlgorithm,
  type LoadBalancerJob,
} from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toLoadBalancerDTO } from '../lib/dto.js';
import { pickNode } from '../services/placement.service.js';
import { resolveLbTargets, type AppAddress } from '../services/loadbalancer.service.js';

const lbInclude = { targets: true } as const;

async function lbWithWorkspace(prisma: PrismaClient, id: string) {
  const lb = await prisma.loadBalancer.findFirst({
    where: { id, deletedAt: null },
    include: { ...lbInclude, project: true },
  });
  if (!lb) throw Errors.notFound('Load balancer not found');
  return { lb, workspaceId: lb.project.workspaceId };
}

export default async function loadBalancerRoutes(app: FastifyInstance) {
  const { prisma, queues, audit, realtime } = app.ctx;

  app.get('/projects/:pid/load-balancers', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.LB_VIEW);
    const loadBalancers = await prisma.loadBalancer.findMany({
      where: { projectId: pid, deletedAt: null },
      include: lbInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { loadBalancers: loadBalancers.map(toLoadBalancerDTO) };
  });

  app.post('/projects/:pid/load-balancers', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.LB_WRITE);
    const body = parse(createLoadBalancerSchema.omit({ projectId: true }), req.body);

    // Resolve app ids (must belong to this project) to their container addresses.
    let appAddresses: AppAddress[] = [];
    if (body.appIds.length > 0) {
      const apps = await prisma.app.findMany({
        where: { id: { in: body.appIds }, projectId: pid, deletedAt: null },
        select: { id: true, port: true },
      });
      const found = new Set(apps.map((a) => a.id));
      const missing = body.appIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw Errors.badRequest(`Unknown app(s) in this project: ${missing.join(', ')}`);
      appAddresses = apps.map((a) => ({ appId: a.id, port: a.port }));
    }
    const targets = resolveLbTargets(appAddresses, body.targets);
    if (targets.length === 0) throw Errors.badRequest('A load balancer needs at least one app or target');

    const nodeId = await pickNode(prisma, project.workspaceId, { nodeId: body.nodeId, region: body.region });
    const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });

    const lb = await prisma.loadBalancer.create({
      data: {
        projectId: pid,
        nodeId,
        name: body.name,
        status: 'provisioning',
        listenPort: body.listenPort,
        algorithm: body.algorithm as LBAlgorithm,
        region: node.region ?? body.region ?? null,
        domain: body.domain ?? null,
        autoHttps: body.autoHttps,
        sticky: body.sticky,
        createdById: req.user!.id,
        targets: { create: targets },
      },
      include: lbInclude,
    });

    const job: LoadBalancerJob = { loadBalancerId: lb.id, action: 'provision' };
    await queues.loadBalancer.add(QUEUE_NAMES.LOADBALANCER, job, { jobId: `lb-${lb.id}`, removeOnComplete: 200 });
    await realtime.publish(SSE_CHANNELS.workspace(project.workspaceId), 'loadbalancer.created', { loadBalancerId: lb.id });
    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'loadbalancer.create',
      targetType: 'loadbalancer',
      targetId: lb.id,
    });
    return { loadBalancer: toLoadBalancerDTO(lb) };
  });

  app.get('/load-balancers/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { lb, workspaceId } = await lbWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.LB_VIEW);
    return { loadBalancer: toLoadBalancerDTO(lb) };
  });

  app.post('/load-balancers/:id/reconcile', async (req) => {
    const { id } = req.params as { id: string };
    const { lb, workspaceId } = await lbWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.LB_WRITE);
    const job: LoadBalancerJob = { loadBalancerId: id, action: 'reconcile' };
    await queues.loadBalancer.add(QUEUE_NAMES.LOADBALANCER, job, { removeOnComplete: 200 });
    return { loadBalancer: toLoadBalancerDTO(lb) };
  });

  app.delete('/load-balancers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { lb, workspaceId } = await lbWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.LB_WRITE);
    await prisma.loadBalancer.update({ where: { id }, data: { deletedAt: new Date(), status: 'failed' } });
    const job: LoadBalancerJob = { loadBalancerId: id, action: 'remove' };
    await queues.loadBalancer.add(QUEUE_NAMES.LOADBALANCER, job, { removeOnComplete: 200 });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'loadbalancer.delete',
      targetType: 'loadbalancer',
      targetId: lb.id,
    });
    reply.status(204).send();
  });
}
