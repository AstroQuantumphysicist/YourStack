import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  nodeRegisterSchema,
  heartbeatRequestSchema,
  commandResultSchema,
  logBatchSchema,
  HEARTBEAT_INTERVAL_MS,
  SSE_CHANNELS,
  type NodeCommand as NodeCommandContract,
} from '@yourstack/shared';
import { generateAgentToken, generateCommandKey, hashToken, verifyToken, AuditAction } from '@yourstack/security';
import { metricBatchSchema } from '@yourstack/shared';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { bearerToken } from '../lib/auth.js';
import { applyCommandResult } from '../services/command-result.service.js';
import { ingestMetrics } from '../services/metrics.service.js';

/** Authenticate the agent via its Bearer token; attaches req.node. */
async function authenticateNode(app: FastifyInstance, req: FastifyRequest): Promise<void> {
  const token = bearerToken(req);
  if (!token || !token.startsWith('ysa_')) throw Errors.unauthorized('Agent token required');
  const hash = hashToken(token);
  const node = await app.ctx.prisma.node.findUnique({
    where: { agentTokenHash: hash },
    select: { id: true, workspaceId: true, commandKey: true, agentTokenHash: true, disabled: true },
  });
  if (!node || !node.agentTokenHash || !verifyToken(token, node.agentTokenHash)) {
    throw Errors.unauthorized('Invalid agent token');
  }
  if (node.disabled) throw Errors.forbidden('This node has been disabled');
  req.node = { id: node.id, workspaceId: node.workspaceId, commandKey: node.commandKey };
}

export default async function agentRoutes(app: FastifyInstance) {
  const { prisma, realtime, audit } = app.ctx;

  // --- Register (join token; no agent auth yet) ---
  app.post('/agent/register', async (req) => {
    const body = parse(nodeRegisterSchema, req.body);
    const tokenHash = hashToken(body.joinToken);
    const joinToken = await prisma.nodeJoinToken.findUnique({ where: { tokenHash } });
    if (!joinToken) throw Errors.unauthorized('Invalid join token');
    if (joinToken.usedAt) throw Errors.unauthorized('Join token already used');
    if (joinToken.expiresAt < new Date()) throw Errors.unauthorized('Join token expired');

    const agentToken = generateAgentToken();
    const commandKey = generateCommandKey(32);
    const t = body.telemetry;

    const node = await prisma.$transaction(async (tx) => {
      const created = await tx.node.create({
        data: {
          workspaceId: joinToken.workspaceId,
          name: body.name,
          status: 'online',
          region: joinToken.region,
          os: t.os,
          arch: t.arch,
          agentVersion: t.agentVersion,
          dockerVersion: t.dockerVersion ?? null,
          publicIp: t.publicIp ?? null,
          cpuCores: t.cpuCores,
          memoryTotalMb: t.memoryTotalMb,
          diskTotalMb: t.diskTotalMb,
          commandKey,
          agentTokenHash: agentToken.hash,
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      });
      await tx.nodeJoinToken.update({
        where: { id: joinToken.id },
        data: { usedAt: new Date(), usedByNode: created.id },
      });
      if (joinToken.label) {
        await tx.nodeLabel.create({ data: { nodeId: created.id, key: 'label', value: joinToken.label } });
      }
      return created;
    });

    await audit({
      workspaceId: node.workspaceId,
      action: AuditAction.NODE_REGISTER,
      targetType: 'node',
      targetId: node.id,
      metadata: { name: node.name, ip: req.ip },
    });
    await realtime.publish(SSE_CHANNELS.workspace(node.workspaceId), 'node.registered', { nodeId: node.id });

    return {
      nodeId: node.id,
      agentToken: agentToken.plaintext,
      commandVerifyKey: commandKey,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    };
  });

  // --- Authenticated agent endpoints ---
  app.register(async (agent) => {
    agent.addHook('onRequest', (req) => authenticateNode(app, req));

    // Heartbeat + telemetry
    agent.post('/agent/heartbeat', async (req) => {
      const body = parse(heartbeatRequestSchema, req.body);
      const t = body.telemetry;
      const node = req.node!;

      const [, pending, current] = await prisma.$transaction([
        prisma.node.update({
          where: { id: node.id },
          data: {
            status: 'online',
            lastHeartbeatAt: new Date(),
            cpuUsagePercent: t.cpuUsagePercent,
            memoryUsedMb: t.memoryUsedMb,
            diskUsedMb: t.diskUsedMb,
            agentVersion: t.agentVersion,
            dockerVersion: t.dockerVersion ?? undefined,
            publicIp: t.publicIp ?? undefined,
            kernel: t.kernel ?? undefined,
          },
        }),
        prisma.nodeCommand.count({ where: { nodeId: node.id, status: 'queued' } }),
        prisma.node.findUnique({ where: { id: node.id }, select: { status: true } }),
      ]);

      await prisma.nodeHeartbeat.create({
        data: {
          nodeId: node.id,
          cpuUsagePercent: t.cpuUsagePercent,
          memoryUsedMb: t.memoryUsedMb,
          diskUsedMb: t.diskUsedMb,
          runningApps: t.runningApps.length,
        },
      });
      await realtime.publish(SSE_CHANNELS.node(node.id), 'node.heartbeat', {
        cpuUsagePercent: t.cpuUsagePercent,
        memoryUsedMb: t.memoryUsedMb,
      });

      const desired = current?.status === 'draining' ? 'draining' : 'online';
      return {
        ok: true as const,
        desiredStatus: desired,
        hasPendingCommands: pending > 0,
        serverTime: new Date().toISOString(),
      };
    });

    // Long-poll for commands. Returns immediately with queued commands, marking
    // them accepted; if none, holds briefly then returns empty.
    agent.get('/agent/commands', async (req) => {
      const node = req.node!;
      const commands = await claimCommands(prisma, node.id);
      if (commands.length === 0) {
        // Short hold to reduce polling churn; wake early via realtime is a client concern.
        await new Promise((r) => setTimeout(r, 1000));
        const retry = await claimCommands(prisma, node.id);
        return { commands: retry };
      }
      return { commands };
    });

    // Report command result / progress.
    agent.post('/agent/commands/:id/result', async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(commandResultSchema.omit({ commandId: true }), req.body);
      const command = await prisma.nodeCommand.findFirst({ where: { id, nodeId: req.node!.id } });
      if (!command) throw Errors.notFound('Command not found');
      await applyCommandResult(prisma, realtime, command, body);
      return { ok: true };
    });

    // Ingest a batch of logs (build/runtime).
    agent.post('/agent/logs', async (req) => {
      const body = parse(logBatchSchema, req.body);
      const node = req.node!;
      // Persist deployment (build) logs and runtime logs into their tables.
      for (const event of body.events) {
        if (event.stream === 'runtime' || event.stream === 'system') {
          await prisma.runtimeLog.create({
            data: {
              appId: event.appId,
              nodeId: node.id,
              severity: event.severity,
              message: event.message.slice(0, 8000),
            },
          });
          await realtime.publish(SSE_CHANNELS.app(event.appId), 'log.runtime', {
            severity: event.severity,
            message: event.message,
            timestamp: event.timestamp,
          });
        } else if (event.deploymentId) {
          const last = await prisma.deploymentLog.aggregate({
            where: { deploymentId: event.deploymentId },
            _max: { seq: true },
          });
          await prisma.deploymentLog.create({
            data: {
              deploymentId: event.deploymentId,
              stream: 'build',
              severity: event.severity,
              message: event.message.slice(0, 8000),
              seq: (last._max.seq ?? 0) + 1,
            },
          });
          await realtime.publish(SSE_CHANNELS.deployment(event.deploymentId), 'log.build', {
            severity: event.severity,
            message: event.message,
            timestamp: event.timestamp,
          });
        }
      }
      return { ok: true, ingested: body.events.length };
    });

    // Ingest a batch of resource metrics (cpu/mem/rps/latency/…) sampled by the agent.
    agent.post('/agent/metrics', async (req) => {
      const batch = parse(metricBatchSchema, req.body);
      const ingested = await ingestMetrics(prisma, realtime, { ...batch, nodeId: batch.nodeId ?? req.node!.id });
      return { ok: true, ingested };
    });
  });
}

/** Atomically move queued commands to `accepted` and return the signed envelopes. */
async function claimCommands(
  prisma: import('@yourstack/db').PrismaClient,
  nodeId: string,
): Promise<NodeCommandContract[]> {
  const queued = await prisma.nodeCommand.findMany({
    where: { nodeId, status: 'queued' },
    orderBy: { issuedAt: 'asc' },
    take: 10,
  });
  if (queued.length === 0) return [];
  const ids = queued.map((c) => c.id);
  await prisma.nodeCommand.updateMany({
    where: { id: { in: ids }, status: 'queued' },
    data: { status: 'accepted', acceptedAt: new Date() },
  });
  return queued.map((c) => ({
    id: c.id,
    nodeId: c.nodeId,
    payload: c.payload as NodeCommandContract['payload'],
    timeoutMs: c.timeoutMs,
    issuedAt: c.issuedAt.toISOString(),
    signature: c.signature,
  }));
}
