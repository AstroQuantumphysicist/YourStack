import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { prisma, type PrismaClient } from '@yourstack/db';
import { createEncryptor, type Encryptor, type AuditSink } from '@yourstack/security';
import { QUEUE_NAMES } from '@yourstack/shared';
import { loadConfig, type AppConfig } from '@yourstack/config';
import { logger } from './logger.js';
import { RealtimeHub } from './realtime/hub.js';
import { GithubClient } from './lib/github.js';

/**
 * Long-lived services shared by every request. Constructed once at boot and
 * decorated onto the Fastify instance as `app.ctx`.
 */
export interface AppContext {
  config: AppConfig;
  prisma: PrismaClient;
  redis: Redis;
  encryptor: Encryptor;
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
  };
  realtime: RealtimeHub;
  github: GithubClient;
  audit: AuditSink;
}

export function createContext(): AppContext {
  const config = loadConfig();
  const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on('error', (err) => logger.error({ err }, 'redis error'));

  const connection = { connection: redis };
  const queues = {
    deploy: new Queue(QUEUE_NAMES.DEPLOY, connection),
    webhook: new Queue(QUEUE_NAMES.WEBHOOK, connection),
    healthcheck: new Queue(QUEUE_NAMES.HEALTHCHECK, connection),
    rollback: new Queue(QUEUE_NAMES.ROLLBACK, connection),
    domain: new Queue(QUEUE_NAMES.DOMAIN, connection),
    maintenance: new Queue(QUEUE_NAMES.MAINTENANCE, connection),
    database: new Queue(QUEUE_NAMES.DATABASE, connection),
    storage: new Queue(QUEUE_NAMES.STORAGE, connection),
    fn: new Queue(QUEUE_NAMES.FUNCTION, connection),
    runner: new Queue(QUEUE_NAMES.RUNNER, connection),
    autoscale: new Queue(QUEUE_NAMES.AUTOSCALE, connection),
  };

  const encryptor = createEncryptor(config.SECRETS_ENCRYPTION_KEY);
  const realtime = new RealtimeHub(config.REDIS_URL);
  const github = new GithubClient(config);

  const audit: AuditSink = async (entry) => {
    try {
      await prisma.auditLog.create({
        data: {
          workspaceId: entry.workspaceId ?? null,
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          metadata: (entry.metadata ?? undefined) as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      logger.error({ err, action: entry.action }, 'failed to write audit log');
    }
  };

  return { config, prisma, redis, encryptor, queues, realtime, github, audit };
}

export async function disposeContext(ctx: AppContext): Promise<void> {
  await Promise.allSettled([
    ...Object.values(ctx.queues).map((q) => q.close()),
    ctx.realtime.close(),
    ctx.prisma.$disconnect(),
    ctx.redis.quit(),
  ]);
}
