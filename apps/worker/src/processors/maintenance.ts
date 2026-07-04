import type { Job } from 'bullmq';
import {
  maintenanceJobSchema,
  NODE_DEGRADED_AFTER_MS,
  NODE_OFFLINE_AFTER_MS,
  SSE_CHANNELS,
} from '@noderail/shared';
import { publish, type WorkerContext } from '../context.js';
import { logger } from '../logger.js';

/** Scheduled background maintenance (repeatable jobs). */
export async function processMaintenance(ctx: WorkerContext, job: Job): Promise<void> {
  const { kind } = maintenanceJobSchema.parse(job.data);
  switch (kind) {
    case 'node_liveness':
      return nodeLiveness(ctx);
    case 'log_retention':
      return logRetention(ctx);
    case 'cleanup':
      return cleanup(ctx);
    case 'usage_rollup':
      return usageRollup(ctx);
  }
}

/** Transition nodes to degraded/offline when heartbeats stop arriving. */
async function nodeLiveness(ctx: WorkerContext): Promise<void> {
  const now = Date.now();
  const nodes = await ctx.prisma.node.findMany({
    where: { deletedAt: null, status: { in: ['online', 'degraded', 'draining'] } },
    select: { id: true, status: true, lastHeartbeatAt: true, workspaceId: true },
  });
  for (const node of nodes) {
    const age = node.lastHeartbeatAt ? now - node.lastHeartbeatAt.getTime() : Infinity;
    let next = node.status;
    if (age > NODE_OFFLINE_AFTER_MS) next = 'offline';
    else if (age > NODE_DEGRADED_AFTER_MS && node.status !== 'draining') next = 'degraded';
    else if (node.status !== 'draining') next = 'online';

    if (next !== node.status) {
      await ctx.prisma.node.update({ where: { id: node.id }, data: { status: next } });
      await publish(ctx, SSE_CHANNELS.node(node.id), 'node.status', { nodeId: node.id, status: next });
      await publish(ctx, SSE_CHANNELS.workspace(node.workspaceId), 'node.status', { nodeId: node.id, status: next });
    }
  }
}

/** Delete logs older than each workspace's plan retention window. */
async function logRetention(ctx: WorkerContext): Promise<void> {
  const workspaces = await ctx.prisma.workspace.findMany({
    where: { deletedAt: null },
    include: { plan: true },
  });
  for (const ws of workspaces) {
    const cutoff = new Date(Date.now() - ws.plan.logRetentionDays * 86400_000);
    const runtime = await ctx.prisma.runtimeLog.deleteMany({
      where: { app: { project: { workspaceId: ws.id } }, createdAt: { lt: cutoff } },
    });
    const build = await ctx.prisma.deploymentLog.deleteMany({
      where: { deployment: { app: { project: { workspaceId: ws.id } } }, createdAt: { lt: cutoff } },
    });
    if (runtime.count || build.count) {
      logger.info({ workspace: ws.slug, runtime: runtime.count, build: build.count }, 'pruned logs');
    }
  }
}

/** Expire join tokens, old heartbeats, and dead sessions. */
async function cleanup(ctx: WorkerContext): Promise<void> {
  const now = new Date();
  await ctx.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await ctx.prisma.nodeJoinToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now }, usedAt: null }, { usedAt: { not: null, lt: new Date(Date.now() - 86400_000) } }] },
  });
  const heartbeatCutoff = new Date(Date.now() - 3 * 86400_000);
  await ctx.prisma.nodeHeartbeat.deleteMany({ where: { createdAt: { lt: heartbeatCutoff } } });
}

/** Prune usage records older than 90 days. */
async function usageRollup(ctx: WorkerContext): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  await ctx.prisma.usageRecord.deleteMany({ where: { day: { lt: cutoff } } });
}
