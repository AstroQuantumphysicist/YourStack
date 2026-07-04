import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES } from '@yourstack/shared';
import { createContext, type WorkerContext } from './context.js';
import { logger } from './logger.js';
import { processDeploy } from './processors/deploy.js';
import { processWebhook } from './processors/webhook.js';
import { processHealthcheck } from './processors/healthcheck.js';
import { processRollback } from './processors/rollback.js';
import { processDomain } from './processors/domain.js';
import { processMaintenance } from './processors/maintenance.js';
import { processDatabase } from './processors/database.js';
import { processStorage } from './processors/storage.js';
import { processFunction } from './processors/function.js';
import { processRunner } from './processors/runner.js';
import { processAutoscale } from './processors/autoscale.js';

type Processor = (ctx: WorkerContext, job: Job) => Promise<void>;

function makeWorker(ctx: WorkerContext, queue: string, processor: Processor, concurrency = 5): Worker {
  const worker = new Worker(
    queue,
    async (job) => {
      logger.info({ queue, jobId: job.id, name: job.name }, 'processing job');
      await processor(ctx, job);
    },
    { connection: ctx.connection, concurrency },
  );
  worker.on('completed', (job) => logger.debug({ queue, jobId: job.id }, 'job completed'));
  worker.on('failed', (job, err) => logger.error({ queue, jobId: job?.id, err }, 'job failed'));
  worker.on('error', (err) => logger.error({ queue, err }, 'worker error'));
  return worker;
}

async function scheduleMaintenance(ctx: WorkerContext): Promise<void> {
  const q = ctx.queues.maintenance;
  const add = (kind: string, every: number) =>
    q.add(
      QUEUE_NAMES.MAINTENANCE,
      { kind },
      { repeat: { every }, jobId: `maint:${kind}`, removeOnComplete: 10, removeOnFail: 10 },
    );
  await add('node_liveness', 30_000);
  await add('log_retention', 60 * 60_000);
  await add('cleanup', 60 * 60_000);
  await add('usage_rollup', 24 * 60 * 60_000);
  await add('metric_rollup', 60 * 60_000);
  logger.info('scheduled repeatable maintenance jobs');
}

async function main() {
  const ctx = createContext();
  const workers = [
    makeWorker(ctx, QUEUE_NAMES.DEPLOY, processDeploy, 4),
    makeWorker(ctx, QUEUE_NAMES.WEBHOOK, processWebhook, 8),
    makeWorker(ctx, QUEUE_NAMES.HEALTHCHECK, processHealthcheck, 8),
    makeWorker(ctx, QUEUE_NAMES.ROLLBACK, processRollback, 4),
    makeWorker(ctx, QUEUE_NAMES.DOMAIN, processDomain, 4),
    makeWorker(ctx, QUEUE_NAMES.MAINTENANCE, processMaintenance, 2),
    makeWorker(ctx, QUEUE_NAMES.DATABASE, processDatabase, 4),
    makeWorker(ctx, QUEUE_NAMES.STORAGE, processStorage, 4),
    makeWorker(ctx, QUEUE_NAMES.FUNCTION, processFunction, 4),
    makeWorker(ctx, QUEUE_NAMES.RUNNER, processRunner, 4),
    makeWorker(ctx, QUEUE_NAMES.AUTOSCALE, processAutoscale, 4),
  ];

  await scheduleMaintenance(ctx);
  logger.info(`YourStack worker started (${workers.length} queues, ${ctx.config.NODE_ENV})`);

  // Simple health server so Railway/Docker can healthcheck the worker.
  startHealthServer(ctx);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await Promise.allSettled(workers.map((w) => w.close()));
    await Promise.allSettled([
      ...Object.values(ctx.queues).map((q) => q.close()),
      ctx.connection.quit(),
      ctx.publisher.quit(),
      ctx.prisma.$disconnect(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
}

function startHealthServer(ctx: WorkerContext): void {
  // The worker exposes a health endpoint for Railway/Docker. Prefer WORKER_PORT,
  // fall back to PORT. If the port is taken (e.g. running alongside the API in
  // local `pnpm dev`), log a warning and continue — the health server is optional.
  const port = Number(process.env.WORKER_PORT ?? ctx.config.PORT);
  import('node:http').then(({ createServer }) => {
    const server = createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.on('error', (err) => {
      logger.warn({ err, port }, 'worker health server unavailable (continuing without it)');
    });
    server.listen(port, () => logger.info(`worker health server on :${port}`));
  });
}

main().catch((err) => {
  logger.error({ err }, 'failed to start worker');
  process.exit(1);
});
