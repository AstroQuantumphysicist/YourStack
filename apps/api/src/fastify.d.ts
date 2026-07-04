import 'fastify';
import type { AppContext } from './context.js';
import type { SessionUser } from './lib/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** Raw request body buffer (preserved for webhook signature verification). */
    rawBody?: Buffer;
    /** Authenticated end-user (session cookie or API token), if present. */
    user?: SessionUser;
    /** Raw session cookie token, when authenticated via cookie. */
    sessionToken?: string;
    /** Authenticated node (agent-token endpoints only). */
    node?: { id: string; workspaceId: string; commandKey: string };
  }
}
