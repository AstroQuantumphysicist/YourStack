import type { PrismaClient, NodeCommand } from '@yourstack/db';
import { CommandType, SSE_CHANNELS, type CommandResult } from '@yourstack/shared';
import type { RealtimeHub } from '../realtime/hub.js';

type ResultInput = Omit<CommandResult, 'commandId'>;

/**
 * Apply an agent-reported command result: update the command row and drive the
 * associated deployment/app state machine. This is the point where a node's
 * report of a successful deploy flips the app to `running`.
 */
export async function applyCommandResult(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  command: NodeCommand,
  result: ResultInput,
): Promise<void> {
  const now = new Date();
  const terminal = ['succeeded', 'failed', 'timed_out'].includes(result.status);

  await prisma.nodeCommand.update({
    where: { id: command.id },
    data: {
      status: result.status,
      output: (result.output ?? {}) as never,
      error: result.error ?? null,
      startedAt: result.status === 'running' ? now : command.startedAt ?? undefined,
      finishedAt: terminal ? now : null,
    },
  });

  await realtime.publish(SSE_CHANNELS.node(command.nodeId), 'command.update', {
    commandId: command.id,
    status: result.status,
  });

  if (!command.deploymentId) return;
  const deploymentId = command.deploymentId;

  if (command.type === CommandType.DEPLOY_APP || command.type === CommandType.ROLLBACK_DEPLOYMENT) {
    if (result.status === 'running') {
      await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'deploying', startedAt: now } });
      await publishDeployment(prisma, realtime, deploymentId, 'deploying');
    } else if (result.status === 'succeeded') {
      await finalizeSuccessfulDeploy(prisma, realtime, deploymentId, result);
    } else if (terminal) {
      await failDeploy(prisma, realtime, deploymentId, result.error ?? 'Deploy failed on node');
    }
  }
}

async function finalizeSuccessfulDeploy(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  deploymentId: string,
  result: ResultInput,
): Promise<void> {
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) return;
  const healthy = result.output?.healthy ?? true;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: healthy ? 'running' : 'failed',
        healthy,
        containerId: result.output?.containerId ?? null,
        imageDigest: result.output?.imageDigest ?? null,
        hostPort: result.output?.hostPort ?? null,
        finishedAt: now,
      },
    });

    if (healthy) {
      // Supersede any other running deployment for this app.
      await tx.deployment.updateMany({
        where: { appId: deployment.appId, status: 'running', id: { not: deploymentId } },
        data: { status: 'superseded' },
      });
      await tx.app.update({
        where: { id: deployment.appId },
        data: { status: 'running', currentDeploymentId: deploymentId, nodeId: deployment.nodeId },
      });
    } else {
      await tx.app.update({ where: { id: deployment.appId }, data: { status: 'failed' } });
    }
  });

  await closePipelineRun(prisma, deploymentId, healthy);
  await publishDeployment(prisma, realtime, deploymentId, healthy ? 'running' : 'failed');
}

async function failDeploy(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  deploymentId: string,
  error: string,
): Promise<void> {
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) return;
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: 'failed', healthy: false, finishedAt: new Date() },
  });
  await prisma.app.update({ where: { id: deployment.appId }, data: { status: 'failed' } });
  await prisma.deploymentLog.create({
    data: {
      deploymentId,
      stream: 'system',
      severity: 'error',
      message: `Deployment failed: ${error}`,
      seq: 999_999,
    },
  });
  await closePipelineRun(prisma, deploymentId, false);
  await publishDeployment(prisma, realtime, deploymentId, 'failed');
}

/** Close the deploy/healthcheck/finalize stages and set the run's final status. */
async function closePipelineRun(
  prisma: PrismaClient,
  deploymentId: string,
  success: boolean,
): Promise<void> {
  const run = await prisma.pipelineRun.findFirst({
    where: { deploymentId },
    include: { stages: true },
  });
  if (!run) return;
  const now = new Date();
  for (const name of ['deploy', 'healthcheck', 'finalize']) {
    const stage = run.stages.find((s) => s.name === name);
    if (!stage) continue;
    await prisma.pipelineStage.update({
      where: { id: stage.id },
      data: {
        status: success ? 'succeeded' : name === 'deploy' ? 'failed' : 'skipped',
        startedAt: stage.startedAt ?? now,
        finishedAt: now,
        exitCode: success ? 0 : 1,
      },
    });
  }
  await prisma.pipelineRun.update({
    where: { id: run.id },
    data: { status: success ? 'succeeded' : 'failed', finishedAt: now },
  });
}

async function publishDeployment(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  deploymentId: string,
  status: string,
): Promise<void> {
  const d = await prisma.deployment.findUnique({ where: { id: deploymentId }, select: { appId: true } });
  await realtime.publish(SSE_CHANNELS.deployment(deploymentId), 'deployment.status', { deploymentId, status });
  if (d) await realtime.publish(SSE_CHANNELS.app(d.appId), 'deployment.status', { deploymentId, status });
}
