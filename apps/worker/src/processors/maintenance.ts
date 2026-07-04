import type { Job } from 'bullmq';
import {
  COMMAND_STALE_GRACE_MS,
  maintenanceJobSchema,
  NODE_DEGRADED_AFTER_MS,
  NODE_OFFLINE_AFTER_MS,
  SSE_CHANNELS,
} from '@yourstack/shared';
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
    case 'metric_rollup':
      return metricRollup(ctx);
  }
}

/** Prune resource metrics older than 7 days to keep the time series bounded. */
async function metricRollup(ctx: WorkerContext): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 86400_000);
  const { count } = await ctx.prisma.resourceMetric.deleteMany({ where: { bucketTs: { lt: cutoff } } });
  if (count) logger.info({ count }, 'pruned resource metrics');
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

      // A node that just went offline can no longer run its apps: flag them so
      // the UI shows reality. They auto-heal when the node reconnects (reconcile).
      if (next === 'offline') {
        await markNodeAppsUnreachable(ctx, node.id, node.workspaceId);
      }
    }
  }

  // Fail commands stuck past their own timeout (their node is offline or wedged),
  // so deploys/actions don't hang forever waiting on a dead agent.
  await reapStaleCommands(ctx);
}

/** Flag a node's running apps as unreachable when the node goes offline. */
async function markNodeAppsUnreachable(
  ctx: WorkerContext,
  nodeId: string,
  workspaceId: string,
): Promise<void> {
  const apps = await ctx.prisma.app.findMany({
    where: { nodeId, deletedAt: null, status: 'running' },
    select: { id: true },
  });
  if (apps.length === 0) return;
  await ctx.prisma.app.updateMany({
    where: { id: { in: apps.map((a) => a.id) } },
    data: { status: 'unreachable' },
  });
  for (const a of apps) {
    await publish(ctx, SSE_CHANNELS.app(a.id), 'app.status', { appId: a.id, status: 'unreachable' });
    await publish(ctx, SSE_CHANNELS.workspace(workspaceId), 'app.status', { appId: a.id, status: 'unreachable' });
  }
  logger.info({ nodeId, count: apps.length }, 'flagged apps unreachable (node offline)');
}

/**
 * Expire node commands that are still `queued`/`accepted` past their own
 * `timeoutMs` plus a grace window. Marks them `failed` so callers (deploys,
 * node actions) don't wait indefinitely on an unresponsive agent.
 */
async function reapStaleCommands(ctx: WorkerContext): Promise<void> {
  const now = Date.now();
  const stale = await ctx.prisma.nodeCommand.findMany({
    where: { status: { in: ['queued', 'accepted'] } },
    select: { id: true, nodeId: true, timeoutMs: true, issuedAt: true, deploymentId: true, appId: true },
    take: 500,
  });
  for (const cmd of stale) {
    const deadline = cmd.issuedAt.getTime() + cmd.timeoutMs + COMMAND_STALE_GRACE_MS;
    if (now < deadline) continue;
    await ctx.prisma.nodeCommand.update({
      where: { id: cmd.id },
      data: { status: 'timed_out', finishedAt: new Date(), error: 'command timed out (agent unresponsive)' },
    });
    // Reflect the failure on a linked deployment so it doesn't stay "deploying".
    if (cmd.deploymentId) {
      await ctx.prisma.deployment
        .updateMany({
          where: { id: cmd.deploymentId, status: { in: ['queued', 'building', 'deploying'] } },
          data: { status: 'failed' },
        })
        .catch(() => undefined);
    }
    logger.info({ commandId: cmd.id, nodeId: cmd.nodeId }, 'reaped stale command');
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
