import type { PrismaClient } from '@noderail/db';
import { signCommand } from '@noderail/security';
import {
  COMMAND_DEFAULT_TIMEOUT_MS,
  SSE_CHANNELS,
  type CommandPayload,
  type CommandType,
} from '@noderail/shared';
import { publish, type WorkerContext } from '../context.js';

/**
 * Create a signed, typed node command from the worker. Mirrors the API's
 * command service so the deploy pipeline can dispatch DEPLOY_APP to the node.
 */
export async function createSignedCommand(
  ctx: WorkerContext,
  input: { nodeId: string; payload: CommandPayload; timeoutMs?: number; deploymentId?: string; appId?: string },
): Promise<{ id: string }> {
  const prisma: PrismaClient = ctx.prisma;
  const node = await prisma.node.findUnique({
    where: { id: input.nodeId },
    select: { id: true, commandKey: true },
  });
  if (!node) throw new Error(`Node not found: ${input.nodeId}`);

  const timeoutMs = input.timeoutMs ?? COMMAND_DEFAULT_TIMEOUT_MS;
  const issuedAt = new Date();
  const command = await prisma.nodeCommand.create({
    data: {
      nodeId: node.id,
      type: input.payload.type as CommandType,
      status: 'queued',
      payload: input.payload as never,
      signature: '',
      timeoutMs,
      deploymentId: input.deploymentId ?? null,
      appId: input.appId ?? null,
      issuedAt,
    },
  });
  const signature = signCommand(
    { id: command.id, nodeId: node.id, payload: input.payload, timeoutMs, issuedAt: issuedAt.toISOString() },
    node.commandKey,
  );
  await prisma.nodeCommand.update({ where: { id: command.id }, data: { signature } });
  await publish(ctx, SSE_CHANNELS.node(node.id), 'command.queued', { commandId: command.id, type: input.payload.type });
  return { id: command.id };
}
