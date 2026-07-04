import type { Job } from 'bullmq';
import {
  CommandType,
  functionJobSchema,
  SSE_CHANNELS,
  type FunctionRuntime,
} from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';
import { resolveEnvForApp } from '../lib/secrets.js';
import { allocatePort } from '../lib/ports.js';

/** Starter templates used when a function has no linked git repo. */
const TEMPLATES: Record<FunctionRuntime, string> = {
  node20: `export async function handler(event){ return { statusCode: 200, body: JSON.stringify({ ok: true, event }) }; }`,
  bun1: `export async function handler(event){ return { statusCode: 200, body: JSON.stringify({ ok: true, event }) }; }`,
  python311: `def handler(event, context):\n    return { "statusCode": 200, "body": { "ok": True, "event": event } }`,
  go122: `package main\nfunc Handler(event map[string]any) (any, error) { return map[string]any{"ok": true}, nil }`,
};

/** Serverless-function processor: build source + dispatch deploy/remove. */
export async function processFunction(ctx: WorkerContext, job: Job): Promise<void> {
  const data = functionJobSchema.parse(job.data);
  const { prisma } = ctx;
  const fn = await prisma.serverlessFunction.findUnique({
    where: { id: data.functionId },
    include: { project: true },
  });
  if (!fn || !fn.nodeId) return;
  const containerName = fn.containerName ?? `yourstack-fn-${fn.id}`;
  const port = allocatePort(`fn-${fn.id}`);
  if (!fn.containerName) {
    await prisma.serverlessFunction.update({ where: { id: fn.id }, data: { containerName } });
  }

  if (data.action === 'deploy') {
    const env = await resolveEnvForApp(prisma, ctx.encryptor, { id: fn.id, projectId: fn.projectId });
    const runtime = fn.runtime as FunctionRuntime;
    const source = fn.repoUrl
      ? ({ kind: 'git', repoUrl: fn.repoUrl, ref: fn.branch ?? 'main' } as const)
      : ({ kind: 'inline', code: TEMPLATES[runtime] } as const);

    await createSignedCommand(ctx, {
      nodeId: fn.nodeId,
      appId: fn.id,
      timeoutMs: 10 * 60_000,
      payload: {
        type: CommandType.DEPLOY_FUNCTION,
        spec: {
          functionId: fn.id,
          name: fn.name,
          runtime,
          handler: fn.handler,
          source,
          env,
          memoryMb: fn.memoryMb,
          timeoutMs: fn.timeoutMs,
          containerName,
          port,
          minInstances: fn.minInstances,
        },
      },
    });
  } else if (data.action === 'remove') {
    await createSignedCommand(ctx, {
      nodeId: fn.nodeId,
      appId: fn.id,
      payload: { type: CommandType.REMOVE_FUNCTION, spec: { functionId: fn.id, containerName } },
    });
  }
  await publish(ctx, SSE_CHANNELS.fn(fn.id), 'function.status', { functionId: fn.id, status: fn.status });
}
