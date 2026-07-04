import type { Job } from 'bullmq';
import { healthcheckJobSchema, TERMINAL_DEPLOYMENT_STATUSES, type DeploymentStatus } from '@yourstack/shared';
import type { WorkerContext } from '../context.js';
import { appendDeploymentLog } from '../lib/logs.js';

/**
 * Safety-net healthcheck. Runs (delayed) after a deploy command is dispatched.
 * If the deployment is still not in a terminal state, the node likely never
 * reported back — mark it failed so it doesn't hang forever. When the node DID
 * report, the deployment is already terminal and this is a no-op.
 */
export async function processHealthcheck(ctx: WorkerContext, job: Job): Promise<void> {
  const data = healthcheckJobSchema.parse(job.data);
  const deployment = await ctx.prisma.deployment.findUnique({ where: { id: data.deploymentId } });
  if (!deployment) return;

  if (TERMINAL_DEPLOYMENT_STATUSES.includes(deployment.status as DeploymentStatus)) {
    return; // node already finalized
  }

  await appendDeploymentLog(
    ctx,
    deployment.id,
    'Healthcheck timeout: node did not report deployment completion in time.',
    { severity: 'error', stream: 'system' },
  );
  await ctx.prisma.deployment.update({
    where: { id: deployment.id },
    data: { status: 'failed', healthy: false, finishedAt: new Date() },
  });
  await ctx.prisma.app.update({ where: { id: deployment.appId }, data: { status: 'failed' } });
  await ctx.prisma.pipelineRun.updateMany({
    where: { deploymentId: deployment.id, status: 'running' },
    data: { status: 'failed', finishedAt: new Date() },
  });
}
