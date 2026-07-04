import { SSE_CHANNELS, type LogSeverity } from '@yourstack/shared';
import { redactLine } from '@yourstack/security';
import { publish, type WorkerContext } from '../context.js';

/**
 * Append a build/system log line to a deployment, redacting secrets, and
 * publish it to the deployment's realtime channel for the live logs UI.
 */
export async function appendDeploymentLog(
  ctx: WorkerContext,
  deploymentId: string,
  message: string,
  opts: { severity?: LogSeverity; secretValues?: string[]; stream?: 'build' | 'system' } = {},
): Promise<void> {
  const clean = redactLine(message, opts.secretValues ?? []);
  const last = await ctx.prisma.deploymentLog.aggregate({
    where: { deploymentId },
    _max: { seq: true },
  });
  await ctx.prisma.deploymentLog.create({
    data: {
      deploymentId,
      stream: opts.stream ?? 'build',
      severity: opts.severity ?? 'info',
      message: clean.slice(0, 8000),
      seq: (last._max.seq ?? 0) + 1,
    },
  });
  await publish(ctx, SSE_CHANNELS.deployment(deploymentId), 'log.build', {
    severity: opts.severity ?? 'info',
    message: clean,
    timestamp: new Date().toISOString(),
  });
}
