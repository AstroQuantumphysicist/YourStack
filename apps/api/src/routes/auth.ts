import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomHex } from '@yourstack/security';
import { AuditAction } from '@yourstack/security';
import { createSession, destroySession, requireUser, SESSION_COOKIE } from '../lib/auth.js';
import { toUserDTO, toWorkspaceDTO } from '../lib/dto.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { slugify } from '../lib/util.js';
import type { WorkspaceRole } from '@yourstack/shared';

const OAUTH_STATE_COOKIE = 'ys_oauth_state';

export default async function authRoutes(app: FastifyInstance) {
  const { prisma, github, config, audit } = app.ctx;

  // --- Begin GitHub OAuth ---
  app.get('/auth/github', async (_req, reply) => {
    if (!github.configured) throw Errors.badRequest('GitHub OAuth is not configured');
    const state = randomHex(16);
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: 600,
      path: '/',
    });
    reply.redirect(github.authorizeUrl(state));
  });

  // --- GitHub OAuth callback ---
  app.get('/auth/github/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE];
    if (!q.code || !q.state || q.state !== stateCookie) {
      throw Errors.badRequest('Invalid OAuth state');
    }
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    const { accessToken, scope } = await github.exchangeCode(q.code);
    const ghUser = await github.getUser(accessToken);
    const email = ghUser.email ?? (await github.getPrimaryEmail(accessToken)) ?? `${ghUser.login}@users.noreply.github.com`;

    const user = await upsertOAuthUser(prisma, app.ctx.encryptor, {
      provider: 'github',
      providerUserId: String(ghUser.id),
      username: ghUser.login,
      email,
      name: ghUser.name ?? ghUser.login,
      avatarUrl: ghUser.avatar_url,
      accessToken,
      scope,
      adminEmails: config.ADMIN_EMAILS,
    });

    const { token, expiresAt } = await createSession(prisma, user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(reply, token, expiresAt, config.isProduction, config.SESSION_COOKIE_DOMAIN);
    await audit({ actorId: user.id, actorEmail: user.email, action: AuditAction.AUTH_LOGIN, ip: req.ip });
    reply.redirect(`${config.PUBLIC_WEB_URL}/dashboard`);
  });

  // --- Dev/local login (no GitHub needed). Disabled in production. ---
  app.post('/auth/dev-login', async (req, reply) => {
    if (config.isProduction) throw Errors.forbidden('Dev login is disabled in production');
    const body = parse(z.object({ email: z.string().email(), name: z.string().optional() }), req.body);
    const isAdmin = config.ADMIN_EMAILS.includes(body.email);
    const user = await prisma.user.upsert({
      where: { email: body.email },
      update: { isPlatformAdmin: isAdmin || undefined },
      create: { email: body.email, name: body.name ?? body.email.split('@')[0], isPlatformAdmin: isAdmin },
    });
    const { token, expiresAt } = await createSession(prisma, user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(reply, token, expiresAt, config.isProduction, config.SESSION_COOKIE_DOMAIN);
    await audit({ actorId: user.id, actorEmail: user.email, action: AuditAction.AUTH_LOGIN, ip: req.ip });
    return { user: toUserDTO(user) };
  });

  // --- Current user + workspaces ---
  app.get('/auth/me', async (req) => {
    const sessionUser = requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } });
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id, workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user: toUserDTO(user),
      workspaces: memberships.map((m) => toWorkspaceDTO(m.workspace, m.role as WorkspaceRole)),
    };
  });

  // --- Logout ---
  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionToken) await destroySession(prisma, req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (req.user) {
      await audit({ actorId: req.user.id, actorEmail: req.user.email, action: AuditAction.AUTH_LOGOUT });
    }
    return { ok: true };
  });
}

function setSessionCookie(
  reply: import('fastify').FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
  domain?: string,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // When served over HTTPS (production), the web app and API may live on
    // different sites (e.g. *.up.railway.app subdomains), so the session cookie
    // must be SameSite=None + Secure to be sent on cross-site fetches.
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
    expires: expiresAt,
    ...(domain ? { domain } : {}),
  });
}

async function upsertOAuthUser(
  prisma: import('@yourstack/db').PrismaClient,
  encryptor: import('@yourstack/security').Encryptor,
  input: {
    provider: string;
    providerUserId: string;
    username: string;
    email: string;
    name: string;
    avatarUrl: string;
    accessToken: string;
    scope: string;
    adminEmails: string[];
  },
) {
  const existing = await prisma.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider: input.provider, providerUserId: input.providerUserId } },
    include: { user: true },
  });
  const encryptedToken = encryptor.encrypt(input.accessToken);
  const isAdmin = input.adminEmails.includes(input.email);

  if (existing) {
    await prisma.oAuthAccount.update({
      where: { id: existing.id },
      data: { accessToken: encryptedToken, scope: input.scope, username: input.username },
    });
    return prisma.user.update({
      where: { id: existing.userId },
      data: { avatarUrl: input.avatarUrl, name: input.name, isPlatformAdmin: isAdmin || undefined },
    });
  }

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      avatarUrl: input.avatarUrl,
      isPlatformAdmin: isAdmin || undefined,
      oauthAccounts: {
        create: {
          provider: input.provider,
          providerUserId: input.providerUserId,
          username: input.username,
          accessToken: encryptedToken,
          scope: input.scope,
        },
      },
    },
    create: {
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
      isPlatformAdmin: isAdmin,
      oauthAccounts: {
        create: {
          provider: input.provider,
          providerUserId: input.providerUserId,
          username: input.username,
          accessToken: encryptedToken,
          scope: input.scope,
        },
      },
    },
  });
}

// Re-export for reuse (slugify used when auto-creating workspace slugs).
export { slugify };
