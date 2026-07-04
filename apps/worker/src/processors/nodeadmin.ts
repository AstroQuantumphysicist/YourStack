import type { Job } from 'bullmq';
import { CommandType, nodeAdminJobSchema, SSE_CHANNELS } from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';

/** Node-administration processor: dispatch the matching signed command to a node. */
export async function processNodeAdmin(ctx: WorkerContext, job: Job): Promise<void> {
  const data = nodeAdminJobSchema.parse(job.data);
  const { prisma } = ctx;
  const node = await prisma.node.findUnique({ where: { id: data.nodeId }, select: { id: true } });
  if (!node) return;

  if (data.action === 'reboot') {
    await createSignedCommand(ctx, {
      nodeId: node.id,
      payload: { type: CommandType.NODE_REBOOT, spec: { delaySeconds: 5 } },
    });
  } else if (data.action === 'docker_prune') {
    await createSignedCommand(ctx, {
      nodeId: node.id,
      timeoutMs: 5 * 60_000,
      payload: {
        type: CommandType.DOCKER_PRUNE,
        spec: { images: true, volumes: false, buildCache: true },
      },
    });
  } else if (data.action === 'agent_update') {
    await createSignedCommand(ctx, {
      nodeId: node.id,
      timeoutMs: 5 * 60_000,
      payload: { type: CommandType.AGENT_UPDATE, spec: { version: data.version ?? 'latest' } },
    });
  }

  await publish(ctx, SSE_CHANNELS.node(node.id), 'node.admin', {
    nodeId: node.id,
    action: data.action,
  });
}
