import type { Job } from 'bullmq';
import {
  CommandType,
  PIPELINE_STAGE_ORDER,
  QUEUE_NAMES,
  SSE_CHANNELS,
  deployJobSchema,
  type HealthcheckJob,
} from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';
import { appendDeploymentLog } from '../lib/logs.js';
import { buildDeploySpec } from '../lib/spec.js';

/**
 * Deploy processor — the heart of the CI/CD pipeline.
 *
 * 1. Creates a PipelineRun with the 8 canonical stages.
 * 2. Runs the control-plane stages (checkout → package): resolve ref, gather
 *    config, build the DeployAppSpec, snapshot it for rollback.
 * 3. Dispatches a signed DEPLOY_APP command to the node (deploy stage → running).
 *    The node performs the build/pull, container start, and healthcheck, then
 *    reports back to the API which finalizes the deployment + pipeline run.
 * 4. Schedules a safety-net healthcheck job in case the node never reports.
 */
export async function processDeploy(ctx: WorkerContext, job: Job): Promise<void> {
  const data = deployJobSchema.parse(job.data);
  const { prisma } = ctx;

  const deployment = await prisma.deployment.findUnique({
    where: { id: data.deploymentId },
    include: { app: { include: { gitRepository: true, project: true } } },
  });
  if (!deployment) throw new Error(`Deployment not found: ${data.deploymentId}`);
  const app = deployment.app;

  if (!app.nodeId) {
    await failDeployment(ctx, deployment.id, app.id, 'No node assigned to app');
    return;
  }

  // Create the pipeline run + stages.
  const run = await prisma.pipelineRun.create({
    data: {
      appId: app.id,
      deploymentId: deployment.id,
      status: 'running',
      trigger: data.triggeredBy === 'webhook' ? 'push' : 'manual',
      ref: deployment.ref,
      commitSha: deployment.commitSha,
      startedAt: new Date(),
      stages: {
        create: PIPELINE_STAGE_ORDER.map((name, i) => ({ name, order: i, status: 'pending' as const })),
      },
    },
    include: { stages: true },
  });
  const stageId = (name: string) => run.stages.find((s) => s.name === name)!.id;

  await prisma.deployment.update({ where: { id: deployment.id }, data: { status: 'building' } });
  await appendDeploymentLog(ctx, deployment.id, `▸ Starting deployment v${deployment.version} for ${app.name}`);

  try {
    // --- checkout ---
    await runStage(ctx, run.id, stageId('checkout'), async () => {
      const ref = deployment.ref ?? app.branch;
      await appendDeploymentLog(ctx, deployment.id, `Resolving source (ref: ${ref})…`);
    });

    // --- install / test / build / package: prep + spec construction ---
    await runStage(ctx, run.id, stageId('install'), async () => {
      await appendDeploymentLog(ctx, deployment.id, `Install command: ${app.installCommand ?? '(auto)'}`);
    });
    await runStage(ctx, run.id, stageId('test'), async () => {
      await appendDeploymentLog(ctx, deployment.id, 'Tests will run on the node during build.');
    });

    const spec = await buildDeploySpec(ctx, { app, deployment, repo: app.gitRepository });
    await runStage(ctx, run.id, stageId('build'), async () => {
      await appendDeploymentLog(
        ctx,
        deployment.id,
        `Build source: ${spec.source.kind} → image ${spec.imageTag}`,
        { secretValues: Object.values(spec.env) },
      );
    });
    await runStage(ctx, run.id, stageId('package'), async () => {
      // Snapshot the spec (without secrets) for rollback re-issue.
      const snapshot = { ...spec, env: {} };
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          imageTag: spec.imageTag,
          containerName: spec.containerName,
          specSnapshot: snapshot as never,
          status: 'deploying',
        },
      });
    });

    // --- deploy: dispatch signed command to the node ---
    await startStage(ctx, stageId('deploy'));
    await appendDeploymentLog(ctx, deployment.id, `Dispatching DEPLOY_APP to node ${app.nodeId}…`);
    await createSignedCommand(ctx, {
      nodeId: app.nodeId,
      appId: app.id,
      deploymentId: deployment.id,
      timeoutMs: 15 * 60_000,
      payload: { type: CommandType.DEPLOY_APP, spec },
    });
    await publish(ctx, SSE_CHANNELS.deployment(deployment.id), 'deployment.status', {
      deploymentId: deployment.id,
      status: 'deploying',
    });

    // Safety-net healthcheck: if the node hasn't finalized in a few minutes,
    // the healthcheck job flips the deployment to failed.
    const hc: HealthcheckJob = { deploymentId: deployment.id, appId: app.id, attempt: 0 };
    await ctx.queues.healthcheck.add(QUEUE_NAMES.HEALTHCHECK, hc, {
      delay: 5 * 60_000,
      removeOnComplete: 200,
      removeOnFail: 200,
    });

    // The `deploy`, `healthcheck`, and `finalize` stages + run status are closed
    // out by the API when the node reports the command result.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendDeploymentLog(ctx, deployment.id, `Deployment error: ${message}`, { severity: 'error' });
    await prisma.pipelineRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date() } });
    await failDeployment(ctx, deployment.id, app.id, message);
    throw err;
  }
}

async function startStage(ctx: WorkerContext, stageId: string): Promise<void> {
  await ctx.prisma.pipelineStage.update({
    where: { id: stageId },
    data: { status: 'running', startedAt: new Date() },
  });
}

async function runStage(
  ctx: WorkerContext,
  _runId: string,
  stageId: string,
  fn: () => Promise<void>,
): Promise<void> {
  await startStage(ctx, stageId);
  try {
    await fn();
    await ctx.prisma.pipelineStage.update({
      where: { id: stageId },
      data: { status: 'succeeded', finishedAt: new Date(), exitCode: 0 },
    });
  } catch (err) {
    await ctx.prisma.pipelineStage.update({
      where: { id: stageId },
      data: { status: 'failed', finishedAt: new Date(), exitCode: 1 },
    });
    throw err;
  }
}

async function failDeployment(
  ctx: WorkerContext,
  deploymentId: string,
  appId: string,
  reason: string,
): Promise<void> {
  await ctx.prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: 'failed', healthy: false, finishedAt: new Date() },
  });
  await ctx.prisma.app.update({ where: { id: appId }, data: { status: 'failed' } });
  await publish(ctx, SSE_CHANNELS.deployment(deploymentId), 'deployment.status', {
    deploymentId,
    status: 'failed',
    reason,
  });
}
