import Fastify, { type FastifyInstance } from 'fastify';
import { API_VERSION } from '@yourstack/shared';
import { loadConfig } from '@yourstack/config';
import { createContext, type AppContext } from './context.js';
import securityPlugin from './plugins/security.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import openapiPlugin from './routes/openapi.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspaces.js';
import projectRoutes from './routes/projects.js';
import appRoutes from './routes/apps.js';
import deploymentRoutes from './routes/deployments.js';
import nodeRoutes from './routes/nodes.js';
import agentRoutes from './routes/agent.js';
import secretRoutes from './routes/secrets.js';
import domainRoutes from './routes/domains.js';
import logRoutes from './routes/logs.js';
import eventRoutes from './routes/events.js';
import repoRoutes from './routes/repos.js';
import webhookRoutes from './routes/webhooks.js';
import tokenRoutes from './routes/tokens.js';
import auditRoutes from './routes/audit.js';
import adminRoutes from './routes/admin.js';
import databaseRoutes from './routes/databases.js';
import storageRoutes from './routes/storage.js';
import functionRoutes from './routes/functions.js';
import runnerRoutes from './routes/runners.js';
import scalingRoutes from './routes/scaling.js';
import regionRoutes from './routes/regions.js';
import metricsQueryRoutes from './routes/metrics-query.js';

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildServer(ctx = createContext()): Promise<BuiltServer> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
        censor: '***',
      },
    },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
  });

  app.decorate('ctx', ctx);

  // Preserve the raw body (buffer) for webhook signature verification while
  // still parsing JSON normally for every route.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    const text = (body as Buffer).toString('utf8');
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error);
    }
  });

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(openapiPlugin);

  // Unversioned operational endpoints.
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

  // Versioned API surface.
  const v1 = async (instance: FastifyInstance) => {
    await instance.register(authRoutes);
    await instance.register(workspaceRoutes);
    await instance.register(projectRoutes);
    await instance.register(appRoutes);
    await instance.register(deploymentRoutes);
    await instance.register(nodeRoutes);
    await instance.register(agentRoutes);
    await instance.register(secretRoutes);
    await instance.register(domainRoutes);
    await instance.register(logRoutes);
    await instance.register(eventRoutes);
    await instance.register(repoRoutes);
    await instance.register(webhookRoutes);
    await instance.register(tokenRoutes);
    await instance.register(auditRoutes);
    await instance.register(adminRoutes);
    // Managed resources (v2)
    await instance.register(databaseRoutes);
    await instance.register(storageRoutes);
    await instance.register(functionRoutes);
    await instance.register(runnerRoutes);
    await instance.register(scalingRoutes);
    await instance.register(regionRoutes);
    await instance.register(metricsQueryRoutes);
  };
  await app.register(v1, { prefix: `/${API_VERSION}` });

  return { app, ctx };
}
