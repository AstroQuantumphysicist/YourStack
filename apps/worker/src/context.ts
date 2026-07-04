import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { prisma, type PrismaClient } from '@yourstack/db';
import { createEncryptor, type Encryptor } from '@yourstack/security';
import { QUEUE_NAMES } from '@yourstack/shared';
import { loadConfig, type AppConfig } from '@yourstack/config';
import { logger } from './logger.js';

export interface WorkerContext {
  config: AppConfig;
  prisma: PrismaClient;
  connection: Redis;
  encryptor: Encryptor;
  publisher: Redis;
  queues: {
    deploy: Queue;
    webhook: Queue;
    healthcheck: Queue;
    rollback: Queue;
    domain: Queue;
    maintenance: Queue;
    database: Queue;
    storage: Queue;
    fn: Queue;
    runner: Queue;
    autoscale: Queue;
    cron: Queue;
    firewall: Queue;
    loadBalancer: Queue;
    nodeAdmin: Queue;
  };
}

const GLOBAL_CHANNEL = 'yourstack:events';

export function createContext(): WorkerContext {
  const config = loadConfig();
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.error({ err }, 'redis connection error'));

  const opts = { connection };
  const queues = {
    deploy: new Queue(QUEUE_NAMES.DEPLOY, opts),
    webhook: new Queue(QUEUE_NAMES.WEBHOOK, opts),
    healthcheck: new Queue(QUEUE_NAMES.HEALTHCHECK, opts),
    rollback: new Queue(QUEUE_NAMES.ROLLBACK, opts),
    domain: new Queue(QUEUE_NAMES.DOMAIN, opts),
    maintenance: new Queue(QUEUE_NAMES.MAINTENANCE, opts),
    database: new Queue(QUEUE_NAMES.DATABASE, opts),
    storage: new Queue(QUEUE_NAMES.STORAGE, opts),
    fn: new Queue(QUEUE_NAMES.FUNCTION, opts),
    runner: new Queue(QUEUE_NAMES.RUNNER, opts),
    autoscale: new Queue(QUEUE_NAMES.AUTOSCALE, opts),
    cron: new Queue(QUEUE_NAMES.CRON, opts),
    firewall: new Queue(QUEUE_NAMES.FIREWALL, opts),
    loadBalancer: new Queue(QUEUE_NAMES.LOADBALANCER, opts),
    nodeAdmin: new Queue(QUEUE_NAMES.NODE_ADMIN, opts),
  };

  return {
    config,
    prisma,
    connection,
    publisher,
    encryptor: createEncryptor(config.SECRETS_ENCRYPTION_KEY),
    queues,
  };
}

/** Publish a realtime event on the shared Redis channel (consumed by the API SSE hub). */
export async function publish(
  ctx: WorkerContext,
  channel: string,
  type: string,
  data: unknown,
): Promise<void> {
  await ctx.publisher.publish(GLOBAL_CHANNEL, JSON.stringify({ channel, type, data }));
}
