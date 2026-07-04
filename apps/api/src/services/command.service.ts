import type { PrismaClient } from '@yourstack/db';
import { signCommand } from '@yourstack/security';
import {
  COMMAND_DEFAULT_TIMEOUT_MS,
  SSE_CHANNELS,
  type CommandPayload,
  type CommandType,
} from '@yourstack/shared';
import type { RealtimeHub } from '../realtime/hub.js';

export interface CreateCommandInput {
  nodeId: string;
  payload: CommandPayload;
  timeoutMs?: number;
  deploymentId?: string;
  appId?: string;
}

/**
 * Create a signed, typed node command. Persists it as `queued`, signs the
 * canonical envelope with the node's per-node HMAC key, and notifies the node
 * channel so a long-polling agent can wake immediately.
 */
export async function createCommand(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  input: CreateCommandInput,
): Promise<{ id: string }> {
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

  // Sign the canonical envelope now that we have the id.
  const signature = signCommand(
    {
      id: command.id,
      nodeId: node.id,
      payload: input.payload,
      timeoutMs,
      issuedAt: issuedAt.toISOString(),
    },
    node.commandKey,
  );
  await prisma.nodeCommand.update({ where: { id: command.id }, data: { signature } });

  await realtime.publish(SSE_CHANNELS.node(node.id), 'command.queued', {
    commandId: command.id,
    type: input.payload.type,
  });

  return { id: command.id };
}
