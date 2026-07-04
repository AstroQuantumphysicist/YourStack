import type { FastifyInstance } from 'fastify';
import { createDomainSchema, Permission, QUEUE_NAMES, type DomainJob } from '@noderail/shared';
import { randomToken, AuditAction } from '@noderail/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toDomainDTO } from '../lib/dto.js';

async function appWorkspace(prisma: import('@noderail/db').PrismaClient, appId: string) {
  const app = await prisma.app.findFirst({ where: { id: appId, deletedAt: null }, include: { project: true, node: true } });
  if (!app) throw Errors.notFound('App not found');
  return app;
}

export default async function domainRoutes(app: FastifyInstance) {
  const { prisma, queues, config, audit } = app.ctx;

  app.get('/apps/:id/domains', async (req) => {
    const { id } = req.params as { id: string };
    const found = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, found.project.workspaceId, Permission.DOMAIN_VIEW);
    const domains = await prisma.domain.findMany({ where: { appId: id }, orderBy: { createdAt: 'desc' } });
    return { domains: domains.map(toDomainDTO) };
  });

  app.post('/apps/:id/domains', async (req) => {
    const { id } = req.params as { id: string };
    const found = await appWorkspace(prisma, id);
    await requirePermission(prisma, req, found.project.workspaceId, Permission.DOMAIN_WRITE);
    const body = parse(createDomainSchema.omit({ appId: true }), req.body);

    if (await prisma.domain.findUnique({ where: { hostname: body.hostname } })) {
      throw Errors.conflict('That hostname is already registered');
    }

    // DNS target: the node's public IP (A record) if known, else the fallback CNAME.
    const dnsTarget = found.node?.publicIp ?? `${found.id}.${config.BASE_PREVIEW_DOMAIN}`;
    const domain = await prisma.domain.create({
      data: {
        appId: id,
        hostname: body.hostname,
        status: 'pending',
        verificationToken: `noderail-verify=${randomToken(16)}`,
        dnsTarget,
        autoHttps: true,
      },
    });
    const job: DomainJob = { domainId: domain.id, attempt: 0 };
    await queues.domain.add(QUEUE_NAMES.DOMAIN, job, { removeOnComplete: 200, removeOnFail: 200 });
    await audit({
      workspaceId: found.project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.DOMAIN_CREATE,
      targetType: 'domain',
      targetId: domain.id,
      metadata: { hostname: body.hostname },
    });
    return { domain: toDomainDTO(domain), instructions: dnsInstructions(body.hostname, dnsTarget) };
  });

  app.post('/domains/:id/verify', async (req) => {
    const { id } = req.params as { id: string };
    const domain = await prisma.domain.findUnique({ where: { id }, include: { app: { include: { project: true } } } });
    if (!domain) throw Errors.notFound('Domain not found');
    await requirePermission(prisma, req, domain.app.project.workspaceId, Permission.DOMAIN_WRITE);
    const job: DomainJob = { domainId: id, attempt: 0 };
    await queues.domain.add(QUEUE_NAMES.DOMAIN, job, { removeOnComplete: 200 });
    return { ok: true, status: 'verifying' };
  });

  app.delete('/domains/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const domain = await prisma.domain.findUnique({ where: { id }, include: { app: { include: { project: true } } } });
    if (!domain) throw Errors.notFound('Domain not found');
    await requirePermission(prisma, req, domain.app.project.workspaceId, Permission.DOMAIN_DELETE);
    await prisma.domain.delete({ where: { id } });
    await audit({ workspaceId: domain.app.project.workspaceId, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.DOMAIN_DELETE, targetType: 'domain', targetId: id });
    reply.status(204).send();
  });
}

function dnsInstructions(hostname: string, target: string) {
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(target);
  return {
    recordType: isIp ? 'A' : 'CNAME',
    name: hostname,
    value: target,
    note: 'Create this DNS record, then verification runs automatically. HTTPS is provisioned via Caddy once DNS resolves.',
  };
}
