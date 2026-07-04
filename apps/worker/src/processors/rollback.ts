import type { Job } from 'bullmq';
import { CommandType, rollbackJobSchema, SSE_CHANNELS, type DeployAppSpec } from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';
import { appendDeploymentLog } from '../lib/logs.js';
import { resolveEnvForApp } from '../lib/secrets.js';

/**
 * Roll an app back to a previous deployment by re-issuing its stored spec
 * snapshot (with freshly-resolved secrets) as a ROLLBACK_DEPLOYMENT command.
 * A new deployment row records the rollback event.
 */
export async function processRollback(ctx: WorkerContext, job: Job): Promise<void> {
  const data = rollbackJobSchema.parse(job.data);
  const { prisma } = ctx;

  const app = await prisma.app.findUnique({ where: { id: data.appId }, include: { project: true } });
  if (!app || !app.nodeId) throw new Error('App not found or has no node');

  const target = await prisma.deployment.findFirst({ where: { id: data.targetDeploymentId, appId: app.id } });
  if (!target || !target.specSnapshot) throw new Error('Target deployment has no spec snapshot');

  // Create a new deployment representing the rollback.
  const last = await prisma.deployment.findFirst({ where: { appId: app.id }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;
  const rollbackDeployment = await prisma.deployment.create({
    data: {
      appId: app.id,
      version,
      status: 'deploying',
      nodeId: app.nodeId,
      ref: target.ref,
      commitSha: target.commitSha,
      commitMessage: target.commitMessage,
      reason: `Rollback to v${target.version}`,
      imageTag: target.imageTag,
      containerName: target.containerName,
      specSnapshot: target.specSnapshot,
      triggeredBy: data.triggeredBy,
      startedAt: new Date(),
    },
  });

  await prisma.app.update({ where: { id: app.id }, data: { status: 'deploying' } });
  await appendDeploymentLog(ctx, rollbackDeployment.id, `Rolling back to deployment v${target.version}…`);

  // Rebuild the spec from the snapshot + fresh secrets.
  const snapshot = target.specSnapshot as unknown as DeployAppSpec;
  const env = await resolveEnvForApp(prisma, ctx.encryptor, app);
  const spec: DeployAppSpec = {
    ...snapshot,
    deploymentId: rollbackDeployment.id,
    env: { ...env, PORT: env.PORT ?? String(app.port) },
  };

  await createSignedCommand(ctx, {
    nodeId: app.nodeId,
    appId: app.id,
    deploymentId: rollbackDeployment.id,
    timeoutMs: 10 * 60_000,
    payload: {
      type: CommandType.ROLLBACK_DEPLOYMENT,
      spec: { appId: app.id, targetDeploymentId: target.id, spec },
    },
  });

  await publish(ctx, SSE_CHANNELS.app(app.id), 'deployment.created', {
    deploymentId: rollbackDeployment.id,
    version,
    rollback: true,
  });
}
