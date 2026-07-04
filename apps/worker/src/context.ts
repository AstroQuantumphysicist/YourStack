import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { prisma, type PrismaClient } from '@noderail/db';
import { createEncryptor, type Encryptor } from '@noderail/security';
import { QUEUE_NAMES } from '@noderail/shared';
import { loadConfig, type AppConfig } from '@noderail/config';
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
  };
}

const GLOBAL_CHANNEL = 'noderail:events';

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
