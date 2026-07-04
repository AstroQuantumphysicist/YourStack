import type { Job } from 'bullmq';
import { CommandType, runnerJobSchema } from '@yourstack/shared';
import { type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';
import { pickOnlineNode } from '../lib/placement.js';
import { logger } from '../logger.js';

/**
 * CI runner-pool processor: reconciles the number of live Runner rows toward the
 * desired count (bounded by the pool's min/max) and dispatches REGISTER_RUNNER /
 * DEREGISTER_RUNNER to nodes.
 *
 * INTEGRATION BOUNDARY: a real GitHub Actions self-hosted runner needs a
 * registration token minted via the GitHub API (`POST /repos|orgs/{scope}/
 * actions/runners/registration-token`) using an installation/OAuth token. We
 * mint it here when a connected repo's install token is available; otherwise we
 * pass a documented placeholder and log that GitHub must be connected. Wiring
 * the token mint is a small, well-isolated follow-up in `lib/github.ts`.
 */
export async function processRunner(ctx: WorkerContext, job: Job): Promise<void> {
  const data = runnerJobSchema.parse(job.data);
  const { prisma } = ctx;
  const pool = await prisma.runnerPool.findUnique({ where: { id: data.poolId }, include: { runners: true } });
  if (!pool) return;

  const desired = Math.max(0, Math.min(data.desired ?? pool.minRunners, pool.maxRunners));
  const live = pool.runners.filter((r) => r.status !== 'offline');

  if (live.length < desired) {
    for (let i = live.length; i < desired; i++) {
      const nodeId = await pickOnlineNode(prisma, pool.workspaceId);
      if (!nodeId) {
        logger.warn({ poolId: pool.id }, 'no online node to place runner');
        break;
      }
      const runner = await prisma.runner.create({
        data: { poolId: pool.id, nodeId, status: 'registering', containerName: '' },
      });
      const containerName = `yourstack-runner-${runner.id}`;
      await prisma.runner.update({ where: { id: runner.id }, data: { containerName } });
      const registrationToken = await mintRunnerToken(ctx, pool.githubScope);
      await createSignedCommand(ctx, {
        nodeId,
        appId: runner.id,
        timeoutMs: 5 * 60_000,
        payload: {
          type: CommandType.REGISTER_RUNNER,
          spec: {
            runnerId: runner.id,
            poolId: pool.id,
            registrationToken,
            githubUrl: `https://github.com/${pool.githubScope}`,
            labels: pool.labels,
            containerName,
            ephemeral: true,
          },
        },
      });
    }
  } else if (live.length > desired) {
    const toRemove = live.slice(desired);
    for (const runner of toRemove) {
      if (runner.nodeId) {
        await createSignedCommand(ctx, {
          nodeId: runner.nodeId,
          appId: runner.id,
          payload: {
            type: CommandType.DEREGISTER_RUNNER,
            spec: { runnerId: runner.id, containerName: runner.containerName ?? `yourstack-runner-${runner.id}` },
          },
        });
      }
      await prisma.runner.update({ where: { id: runner.id }, data: { status: 'offline' } });
    }
  }
}

/** Mint a GitHub Actions registration token (integration boundary — see header). */
async function mintRunnerToken(_ctx: WorkerContext, _githubScope: string): Promise<string> {
  // TODO(github): call POST /repos|orgs/{scope}/actions/runners/registration-token
  // with the connected repo's install token. Until GitHub is connected for the
  // pool's scope, emit a clearly-marked placeholder the agent will surface.
  return `PLACEHOLDER_CONNECT_GITHUB`;
}
