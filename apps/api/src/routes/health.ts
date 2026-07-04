import type { FastifyInstance } from 'fastify';
import { AGENT_PROTOCOL_VERSION } from '@yourstack/shared';

/** Liveness + readiness. `/health` is used by Railway/Docker healthchecks. */
export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'api', time: new Date().toISOString() }));

  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, boolean> = { db: false, redis: false };
    try {
      await app.ctx.prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {
      /* db down */
    }
    try {
      checks.redis = (await app.ctx.redis.ping()) === 'PONG';
    } catch {
      /* redis down */
    }
    const ready = checks.db && checks.redis;
    reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'degraded', checks });
  });

  app.get('/version', async () => ({
    service: 'yourstack-api',
    protocolVersion: AGENT_PROTOCOL_VERSION,
  }));
}
