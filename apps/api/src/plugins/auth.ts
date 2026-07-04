import fp from 'fastify-plugin';
import { resolveApiTokenUser, resolveSessionUser, SESSION_COOKIE, bearerToken } from '../lib/auth.js';

/**
 * Populates `req.user` from either the session cookie or a Bearer API token.
 * Does NOT reject unauthenticated requests — individual routes call
 * `requireUser` / `requirePermission` as needed. Agent-token auth is handled
 * separately in the agent routes.
 */
export default fp(async function authPlugin(app) {
  app.decorateRequest('user', undefined);
  app.decorateRequest('sessionToken', undefined);
  app.decorateRequest('node', undefined);

  app.addHook('onRequest', async (req) => {
    const cookieToken = req.cookies?.[SESSION_COOKIE];
    if (cookieToken) {
      const user = await resolveSessionUser(app.ctx.prisma, cookieToken);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isPlatformAdmin: user.isPlatformAdmin,
        };
        req.sessionToken = cookieToken;
        return;
      }
    }

    const bearer = bearerToken(req);
    if (bearer?.startsWith('nr_')) {
      const user = await resolveApiTokenUser(app.ctx.prisma, bearer);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isPlatformAdmin: user.isPlatformAdmin,
        };
      }
    }
  });
});
