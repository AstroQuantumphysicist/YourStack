import type { Job } from 'bullmq';
import { promises as dns } from 'node:dns';
import {
  CommandType,
  domainJobSchema,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type DomainJob,
} from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';

const MAX_ATTEMPTS = 10;

/**
 * Verify a custom domain's DNS points at the node, then dispatch a
 * CONFIGURE_DOMAIN command so the agent provisions the Caddy reverse-proxy
 * route with automatic HTTPS. Retries with backoff until DNS resolves.
 */
export async function processDomain(ctx: WorkerContext, job: Job): Promise<void> {
  const data = domainJobSchema.parse(job.data);
  const { prisma } = ctx;

  const domain = await prisma.domain.findUnique({
    where: { id: data.domainId },
    include: { app: { include: { node: true } } },
  });
  if (!domain) return;
  const node = domain.app.node;

  await prisma.domain.update({
    where: { id: domain.id },
    data: { status: 'verifying', lastCheckedAt: new Date() },
  });

  const resolved = await resolvesToTarget(domain.hostname, domain.dnsTarget, node?.publicIp ?? null);

  if (!resolved) {
    if (data.attempt + 1 >= MAX_ATTEMPTS) {
      await prisma.domain.update({ where: { id: domain.id }, data: { status: 'failed' } });
      await publish(ctx, SSE_CHANNELS.app(domain.appId), 'domain.status', { domainId: domain.id, status: 'failed' });
      return;
    }
    const next: DomainJob = { domainId: domain.id, attempt: data.attempt + 1 };
    await ctx.queues.domain.add(QUEUE_NAMES.DOMAIN, next, { delay: 60_000, removeOnComplete: 200 });
    return;
  }

  await prisma.domain.update({
    where: { id: domain.id },
    data: { status: 'verified', verifiedAt: new Date() },
  });

  // Provision the reverse proxy on the node (Caddy auto-HTTPS).
  if (node) {
    await createSignedCommand(ctx, {
      nodeId: node.id,
      appId: domain.appId,
      payload: {
        type: CommandType.CONFIGURE_DOMAIN,
        spec: {
          appId: domain.appId,
          containerName: `yourstack-${domain.appId}`,
          domain: { domain: domain.hostname, autoHttps: domain.autoHttps, targetPort: domain.app.port },
        },
      },
    });
    await prisma.domain.update({ where: { id: domain.id }, data: { status: 'active' } });
  }

  await publish(ctx, SSE_CHANNELS.app(domain.appId), 'domain.status', {
    domainId: domain.id,
    status: node ? 'active' : 'verified',
  });
}

async function resolvesToTarget(hostname: string, target: string, nodeIp: string | null): Promise<boolean> {
  try {
    const addrs = await dns.resolve4(hostname).catch(() => [] as string[]);
    if (nodeIp && addrs.includes(nodeIp)) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(target) && addrs.includes(target)) return true;
    // CNAME check
    const cnames = await dns.resolveCname(hostname).catch(() => [] as string[]);
    if (cnames.some((c) => c === target || c.endsWith(target))) return true;
    return false;
  } catch {
    return false;
  }
}
