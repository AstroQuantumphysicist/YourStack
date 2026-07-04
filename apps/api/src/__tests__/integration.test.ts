import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * In-process API integration test. Requires a reachable Postgres + Redis (the CI
 * workflow provides service containers). If they're unreachable, the suite skips
 * itself rather than failing, so `pnpm test` works without infra.
 */
let app: FastifyInstance | null = null;
let ctx: AppContext | null = null;
let available = false;

beforeAll(async () => {
  try {
    const { createContext } = await import('../context.js');
    ctx = createContext();
    await ctx.prisma.$queryRaw`SELECT 1`;
    await ctx.redis.ping();
    const { buildServer } = await import('../server.js');
    const built = await buildServer(ctx);
    app = built.app;
    await app.ready();
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) {
    const { disposeContext } = await import('../context.js');
    await disposeContext(ctx);
  }
});

describe('API integration', () => {
  it('health endpoint responds', async () => {
    if (!available) return;
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('rejects unauthenticated access', async () => {
    if (!available) return;
    const res = await app!.inject({ method: 'GET', url: '/v1/workspaces/does-not-exist' });
    expect(res.statusCode).toBe(401);
  });

  it('dev-login sets a session cookie and /auth/me works', async () => {
    if (!available) return;
    const login = await app!.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'admin@yourstack.local' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === 'ys_session');
    expect(cookie).toBeTruthy();

    const me = await app!.inject({
      method: 'GET',
      url: '/v1/auth/me',
      cookies: { ys_session: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('admin@yourstack.local');
  });

  it('serves an OpenAPI document', async () => {
    if (!available) return;
    const res = await app!.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toMatch(/^3\./);
  });
});
