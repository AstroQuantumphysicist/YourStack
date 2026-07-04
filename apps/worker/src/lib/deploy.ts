import { QUEUE_NAMES, SSE_CHANNELS, type DeployJob } from '@yourstack/shared';
import type { App } from '@yourstack/db';
import { publish, type WorkerContext } from '../context.js';

/** Create a Deployment row and enqueue it for the deploy processor. */
export async function createDeployment(
  ctx: WorkerContext,
  input: {
    app: App;
    triggeredBy: string;
    ref?: string;
    commitSha?: string;
    commitMessage?: string;
    reason?: string;
  },
): Promise<{ deploymentId: string; version: number } | null> {
  const { prisma } = ctx;
  const { app } = input;
  if (!app.nodeId) return null;

  const project = await prisma.project.findUniqueOrThrow({ where: { id: app.projectId } });
  const workspaceId = project.workspaceId;
  const day = new Date().toISOString().slice(0, 10);

  const deployment = await prisma.$transaction(async (tx) => {
    const last = await tx.deployment.findFirst({
      where: { appId: app.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const d = await tx.deployment.create({
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
      },
    });
    await tx.app.update({ where: { id: app.id }, data: { status: 'building' } });
    await tx.usageRecord.upsert({
      where: { workspaceId_metric_day: { workspaceId, metric: 'deployments', day } },
      create: { workspaceId, metric: 'deployments', day, quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
    return d;
  });

  const job: DeployJob = {
    deploymentId: deployment.id,
    appId: app.id,
    triggeredBy: input.triggeredBy,
    ref: input.ref,
  };
  await ctx.queues.deploy.add(QUEUE_NAMES.DEPLOY, job, {
    jobId: deployment.id,
    attempts: 1,
    removeOnComplete: 500,
    removeOnFail: 500,
  });
  await publish(ctx, SSE_CHANNELS.app(app.id), 'deployment.created', {
    deploymentId: deployment.id,
    version: deployment.version,
  });
  return { deploymentId: deployment.id, version: deployment.version };
}
