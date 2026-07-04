import type { Job } from 'bullmq';
import { CommandType, CronJobStatus, QUEUE_NAMES, SSE_CHANNELS } from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';

/**
 * Cron processor. The CRON queue carries two shapes of job, distinguished by a
 * `fire` flag on the job data:
 *
 *  - **control job** `{ cronJobId }` (no `fire`, or `fire:false`): (re)registers a
 *    repeatable BullMQ job for this cron using its stored 5-field `schedule`, or
 *    tears the scheduler down when the cron is paused/deleted. The control job is
 *    enqueued by the API whenever a cron is created/updated/paused/deleted.
 *  - **fire job** `{ cronJobId, fire:true }`: one actual run. Enqueued either by
 *    the repeatable scheduler when the schedule triggers, or directly for a
 *    "run now". It creates a CronRun, decrypts env, and dispatches a signed
 *    RUN_JOB command to the cron's node.
 *
 * We keep the discriminator out of the shared `cronJobSchema` (which is fixed at
 * `{ cronJobId }`): `isFireJob` reads the optional `fire` flag straight off the
 * raw job data so both shapes travel on the same queue without a schema change.
 */

/** Scheduler id for a cron's repeatable job (also used as the BullMQ `jobId`). */
export function cronSchedulerId(cronJobId: string): string {
  return `cron:${cronJobId}`;
}

/** Discriminator: is this a "fire" (run once) job vs a control (register) job? */
export function isFireJob(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { fire?: unknown }).fire === true;
}

/**
 * Split a stored cron command string into an argv array by whitespace. Returns
 * `undefined` for an empty/absent command so the image's own ENTRYPOINT/CMD runs.
 * Pure + unit-tested.
 */
export function splitCommand(command: string | null | undefined): string[] | undefined {
  if (!command) return undefined;
  const parts = command.trim().split(/\s+/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export async function processCron(ctx: WorkerContext, job: Job): Promise<void> {
  const cronJobId = String((job.data as { cronJobId?: unknown }).cronJobId ?? '');
  if (!cronJobId) return;

  if (isFireJob(job.data)) {
    await fireCronRun(ctx, cronJobId);
  } else {
    await reconcileScheduler(ctx, cronJobId);
  }
}

/**
 * Control job: register/refresh or remove the repeatable scheduler for a cron,
 * respecting its status. Active + not deleted → (re)register; otherwise remove.
 */
async function reconcileScheduler(ctx: WorkerContext, cronJobId: string): Promise<void> {
  const { prisma } = ctx;
  const cron = await prisma.cronJob.findUnique({ where: { id: cronJobId } });
  const queue = ctx.queues.cron;
  const schedulerId = cronSchedulerId(cronJobId);

  const active = cron && !cron.deletedAt && cron.status === CronJobStatus.ACTIVE;
  if (!active) {
    // Paused, deleted, or missing: tear the scheduler down (idempotent).
    await queue.removeJobScheduler(schedulerId).catch(() => undefined);
    return;
  }

  // (Re)register the repeatable fire job on this cron's 5-field schedule. Using a
  // stable jobId means re-running the control job just updates the schedule.
  await queue.add(
    QUEUE_NAMES.CRON,
    { cronJobId, fire: true },
    { repeat: { pattern: cron.schedule }, jobId: schedulerId },
  );
  await publish(ctx, SSE_CHANNELS.cron(cronJobId), 'cron.scheduled', {
    cronJobId,
    schedule: cron.schedule,
  });
}

/**
 * Fire job: create a CronRun and dispatch a signed RUN_JOB command to the node.
 * The API finalizes the run when the agent reports the command result — the
 * command's `appId` is set to the runId so the API can correlate the callback.
 */
async function fireCronRun(ctx: WorkerContext, cronJobId: string): Promise<void> {
  const { prisma } = ctx;
  const cron = await prisma.cronJob.findUnique({ where: { id: cronJobId } });
  if (!cron || cron.deletedAt || !cron.nodeId) return;
  if (cron.status === CronJobStatus.PAUSED) return;

  const run = await prisma.cronRun.create({
    data: { cronJobId: cron.id, status: 'running' },
  });

  const env = cron.envCipher ? safeDecryptEnv(ctx, cron.envCipher) : {};
  const timeoutMs = Math.max(1, cron.timeoutSeconds) * 1000;

  await createSignedCommand(ctx, {
    nodeId: cron.nodeId,
    // Correlate the command callback to the CronRun via appId = runId.
    appId: run.id,
    // Give the command-level deadline a buffer beyond the job's own timeout so
    // the agent's internal timeout fires first and kills the container itself
    // (rather than the command being abandoned with the container still running).
    timeoutMs: timeoutMs + 30_000,
    payload: {
      type: CommandType.RUN_JOB,
      spec: {
        jobId: cron.id,
        runId: run.id,
        containerName: `yourstack-job-${run.id}`,
        image: cron.image,
        command: splitCommand(cron.command),
        env,
        resources: { cpu: cron.cpu, memoryMb: cron.memoryMb },
        timeoutMs,
      },
    },
  });

  await prisma.cronJob.update({
    where: { id: cron.id },
    data: { lastRunAt: new Date(), status: CronJobStatus.RUNNING },
  });
  await publish(ctx, SSE_CHANNELS.cron(cron.id), 'cron.run', {
    cronJobId: cron.id,
    runId: run.id,
    status: 'running',
  });
}

/** Decrypt the env ciphertext (JSON map). Returns `{}` on any failure. */
function safeDecryptEnv(ctx: WorkerContext, cipher: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(ctx.encryptor.decrypt(cipher));
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = String(v);
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
}
