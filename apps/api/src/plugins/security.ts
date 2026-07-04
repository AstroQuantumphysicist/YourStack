import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { AppConfig } from '@yourstack/config';

/**
 * Registers baseline HTTP security: Helmet headers, locked-down CORS (only the
 * configured web origin + explicit allowlist, credentials enabled), signed
 * cookies, and global rate limiting.
 */
export default fp(async function securityPlugin(app) {
  const config = app.ctx.config as AppConfig;

  await app.register(sensible);

  await app.register(helmet, {
    contentSecurityPolicy: false, // API returns JSON; CSP is enforced by the web app.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const allowed = new Set<string>([config.PUBLIC_WEB_URL, ...config.CORS_ORIGINS]);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin / server-to-server (no Origin header) and the allowlist.
      if (!origin || allowed.has(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {
    secret: config.SESSION_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
      ...(config.SESSION_COOKIE_DOMAIN ? { domain: config.SESSION_COOKIE_DOMAIN } : {}),
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    redis: app.ctx.redis,
    // Rate-limit by authenticated user when possible, else by IP.
    keyGenerator: (req) => req.user?.id ?? req.ip,
    allowList: (req) => req.url === '/health' || req.url === '/metrics',
  });
});
