import type { PrismaClient } from '@yourstack/db';
import {
  QUEUE_NAMES,
  SSE_CHANNELS,
  type DeployJob,
} from '@yourstack/shared';
import type { Queue } from 'bullmq';
import { Errors } from '../lib/errors.js';
import { todayKey } from '../lib/util.js';
import type { RealtimeHub } from '../realtime/hub.js';

export interface TriggerDeploymentInput {
  appId: string;
  triggeredBy: string; // "manual" | "webhook" | "cli" | "reconcile" | email
  triggeredById?: string;
  ref?: string;
  commitSha?: string;
  commitMessage?: string;
  reason?: string;
  /**
   * System-initiated deployment (e.g. auto-heal when a node reconnects). These
   * bypass the daily deployment quota and are not counted against it, since the
   * user didn't request them.
   */
  system?: boolean;
}

/**
 * Create a new Deployment for an app and enqueue the deploy job. Enforces the
 * workspace plan's daily deployment limit and requires an assigned node.
 */
export async function triggerDeployment(
  prisma: PrismaClient,
  deployQueue: Queue,
  realtime: RealtimeHub,
  input: TriggerDeploymentInput,
): Promise<{ deploymentId: string; version: number }> {
  const app = await prisma.app.findFirst({
    where: { id: input.appId, deletedAt: null },
    include: { project: { include: { workspace: { include: { plan: true } } } } },
  });
  if (!app) throw Errors.notFound('App not found');
  if (!app.nodeId) {
    throw Errors.badRequest('App has no node assigned. Assign an online node before deploying.');
  }

  const workspace = app.project.workspace;
  const day = todayKey();

  // Enforce daily deployment plan limit (skipped for system-initiated auto-heal).
  if (!input.system) {
    const usage = await prisma.usageRecord.findUnique({
      where: { workspaceId_metric_day: { workspaceId: workspace.id, metric: 'deployments', day } },
    });
    if ((usage?.quantity ?? 0) >= workspace.plan.maxDeploymentsPerDay) {
      throw Errors.planLimit(
        `Daily deployment limit reached (${workspace.plan.maxDeploymentsPerDay}). Upgrade your plan.`,
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.deployment.findFirst({
      where: { appId: app.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    const deployment = await tx.deployment.create({
      data: {
        appId: app.id,
        version,
        status: 'queued',
        nodeId: app.nodeId,
        ref: input.ref ?? app.branch,
        commitSha: input.commitSha ?? null,
        commitMessage: input.commitMessage ?? null,
        reason: input.reason ?? null,
        strategy: app.deploymentStrategy,
        triggeredBy: input.triggeredBy,
        triggeredById: input.triggeredById ?? null,
      },
    });

    await tx.app.update({ where: { id: app.id }, data: { status: 'building' } });

    // System-initiated auto-heal deployments are not billed against the quota.
    if (!input.system) {
      await tx.usageRecord.upsert({
        where: { workspaceId_metric_day: { workspaceId: workspace.id, metric: 'deployments', day } },
        create: { workspaceId: workspace.id, metric: 'deployments', day, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });
    }

    return { deployment, version };
  });

  const job: DeployJob = {
    deploymentId: result.deployment.id,
    appId: app.id,
    triggeredBy: input.triggeredBy,
    ref: input.ref,
  };
  await deployQueue.add(QUEUE_NAMES.DEPLOY, job, {
    jobId: result.deployment.id,
    attempts: 1,
    removeOnComplete: 500,
    removeOnFail: 500,
  });

  await realtime.publish(SSE_CHANNELS.app(app.id), 'deployment.created', {
    deploymentId: result.deployment.id,
    version: result.version,
  });

  return { deploymentId: result.deployment.id, version: result.version };
}
