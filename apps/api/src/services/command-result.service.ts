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

  // Managed-resource commands (v2) carry their target id in the signed payload.
  if (RESOURCE_COMMAND_TYPES.has(command.type)) {
    if (terminal) await applyResourceResult(prisma, realtime, command, result);
    return;
  }

  // Scheduled jobs (v3): a RUN_JOB result closes out a CronRun.
  if (command.type === CommandType.RUN_JOB) {
    if (terminal) await applyCronRunResult(prisma, realtime, command, result);
    return;
  }

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

/* ----------------------- Managed-resource finalization ---------------------- */

const RESOURCE_COMMAND_TYPES = new Set<string>([
  CommandType.PROVISION_DATABASE,
  CommandType.STOP_DATABASE,
  CommandType.REMOVE_DATABASE,
  CommandType.BACKUP_DATABASE,
  CommandType.PROVISION_STORAGE,
  CommandType.REMOVE_STORAGE,
  CommandType.DEPLOY_FUNCTION,
  CommandType.INVOKE_FUNCTION,
  CommandType.REMOVE_FUNCTION,
  CommandType.REGISTER_RUNNER,
  CommandType.DEREGISTER_RUNNER,
  CommandType.SCALE_APP,
]);

/** Map a terminal command status to a CronRun status string. */
function cronRunStatus(status: ResultInput['status']): string {
  if (status === 'succeeded') return 'success';
  if (status === 'timed_out') return 'timeout';
  return 'failed';
}

/**
 * Close out a CronRun from a RUN_JOB result: record exit code/duration and roll
 * the parent CronJob's lastRun summary forward. The run row is upserted so it is
 * self-healing even if the worker's initial "running" insert was lost.
 */
async function applyCronRunResult(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  command: NodeCommand,
  result: ResultInput,
): Promise<void> {
  const payload = command.payload as { type: string; spec: { jobId?: string; runId?: string } };
  const jobId = payload.spec?.jobId;
  const runId = payload.spec?.runId;
  if (!jobId || !runId) return;

  const status = cronRunStatus(result.status);
  const out = result.output ?? {};
  const now = new Date();
  const exitCode = typeof out.exitCode === 'number' ? out.exitCode : status === 'success' ? 0 : 1;
  const durationMs = typeof out.durationMs === 'number' ? out.durationMs : null;

  await prisma.cronRun.upsert({
    where: { id: runId },
    create: {
      id: runId,
      cronJobId: jobId,
      status,
      exitCode,
      durationMs,
      startedAt: command.startedAt ?? now,
      finishedAt: now,
    },
    update: { status, exitCode, durationMs, finishedAt: now },
  });

  // Roll the parent job's last-run summary forward (keep paused jobs paused).
  const job = await prisma.cronJob.findUnique({ where: { id: jobId }, select: { status: true } });
  await prisma.cronJob.updateMany({
    where: { id: jobId },
    data: {
      lastRunAt: now,
      lastRunStatus: status,
      status: job?.status === 'paused' ? undefined : 'active',
    },
  });

  await realtime.publish(SSE_CHANNELS.cron(jobId), 'cron.run', { cronJobId: jobId, runId, status });
}

/** Drive the state of a managed resource from an agent's command result. */
async function applyResourceResult(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  command: NodeCommand,
  result: ResultInput,
): Promise<void> {
  const payload = command.payload as { type: string; spec: Record<string, unknown> };
  const spec = payload.spec ?? {};
  const ok = result.status === 'succeeded';
  const out = result.output ?? {};

  switch (command.type) {
    case CommandType.PROVISION_DATABASE: {
      const id = String(spec.databaseId);
      await prisma.managedDatabase.update({
        where: { id },
        data: {
          status: ok ? 'running' : 'failed',
          containerId: (out.containerId as string) ?? undefined,
          port: (out.hostPort as number) ?? undefined,
        },
      });
      await realtime.publish(SSE_CHANNELS.database(id), 'database.status', { databaseId: id, status: ok ? 'running' : 'failed' });
      break;
    }
    case CommandType.STOP_DATABASE:
    case CommandType.REMOVE_DATABASE: {
      const id = String(spec.databaseId);
      if (command.type === CommandType.STOP_DATABASE) {
        await prisma.managedDatabase.updateMany({ where: { id }, data: { status: ok ? 'stopped' : 'failed' } });
      }
      break;
    }
    case CommandType.BACKUP_DATABASE: {
      const id = String(spec.databaseId);
      await prisma.managedDatabase.updateMany({ where: { id }, data: { lastBackupAt: new Date(), status: 'running' } });
      break;
    }
    case CommandType.PROVISION_STORAGE: {
      const id = String(spec.bucketId);
      await prisma.storageBucket.update({
        where: { id },
        data: { status: ok ? 'active' : 'failed', endpoint: (out.extra?.['endpoint'] as string) ?? undefined },
      });
      await realtime.publish(SSE_CHANNELS.bucket(id), 'bucket.status', { bucketId: id, status: ok ? 'active' : 'failed' });
      break;
    }
    case CommandType.DEPLOY_FUNCTION: {
      const id = String(spec.functionId);
      await prisma.serverlessFunction.update({
        where: { id },
        data: { status: ok ? 'active' : 'failed', url: (out.extra?.['url'] as string) ?? undefined },
      });
      await realtime.publish(SSE_CHANNELS.fn(id), 'function.status', { functionId: id, status: ok ? 'active' : 'failed' });
      break;
    }
    case CommandType.INVOKE_FUNCTION: {
      const id = String(spec.functionId);
      await prisma.functionInvocation.create({
        data: {
          functionId: id,
          status: ok ? 'success' : 'error',
          durationMs: (out.durationMs as number) ?? 0,
          statusCode: (out.exitCode as number) ?? (ok ? 200 : 500),
        },
      });
      break;
    }
    case CommandType.REGISTER_RUNNER:
    case CommandType.DEREGISTER_RUNNER: {
      const id = String(spec.runnerId);
      await prisma.runner.updateMany({
        where: { id },
        data: {
          status: command.type === CommandType.REGISTER_RUNNER ? (ok ? 'idle' : 'offline') : 'offline',
          lastSeenAt: new Date(),
        },
      });
      break;
    }
    case CommandType.SCALE_APP: {
      const id = String(spec.appId);
      const replicas = (out.extra?.['replicas'] as number) ?? (spec.replicas as number);
      if (typeof replicas === 'number') {
        await prisma.scalingPolicy.updateMany({ where: { appId: id }, data: { currentReplicas: replicas } });
      }
      break;
    }
  }
}
