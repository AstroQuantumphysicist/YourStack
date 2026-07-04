import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import { GithubAccountType, Permission } from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { Errors } from '../lib/errors.js';
import { toGithubInstallationDTO } from '../lib/dto.js';

/**
 * GitHub App integration: install flow, installation management, and repo
 * listing via installation access tokens. The install `state` carries the
 * target workspace id, HMAC-signed so the callback can trust it without a
 * session (GitHub redirects the browser back unauthenticated).
 */

function signState(workspaceId: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(workspaceId).digest('base64url');
  return Buffer.from(`${workspaceId}.${mac}`).toString('base64url');
}

function verifyState(state: string, secret: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.lastIndexOf('.');
  if (idx <= 0) return null;
  const workspaceId = decoded.slice(0, idx);
  const mac = decoded.slice(idx + 1);
  const expected = createHmac('sha256', secret).update(workspaceId).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return workspaceId;
}

/** Resolve the workspace that owns a GithubInstallation record. */
async function installationWithWorkspace(prisma: PrismaClient, id: string) {
  const installation = await prisma.githubInstallation.findUnique({ where: { id } });
  if (!installation) throw Errors.notFound('GitHub installation not found');
  return { installation, workspaceId: installation.workspaceId };
}

export default async function githubAppRoutes(app: FastifyInstance) {
  const { prisma, github, config, audit } = app.ctx;

  // Build the install URL for a workspace (carries a signed state).
  app.get('/github/app/install-url', async (req) => {
    if (!github.appConfigured) throw Errors.badRequest('GitHub App is not configured');
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) throw Errors.badRequest('workspaceId is required');
    await requirePermission(prisma, req, workspaceId, Permission.GITHUB_APP_MANAGE);
    const state = signState(workspaceId, config.SESSION_SECRET);
    return { url: github.appInstallUrl(state) };
  });

  // Post-install callback (browser redirect from GitHub — unauthenticated).
  app.get('/github/app/callback', async (req, reply) => {
    if (!github.appConfigured) throw Errors.badRequest('GitHub App is not configured');
    const q = req.query as { installation_id?: string; setup_action?: string; state?: string };
    if (!q.installation_id || !q.state) throw Errors.badRequest('Missing installation_id or state');
    const workspaceId = verifyState(q.state, config.SESSION_SECRET);
    if (!workspaceId) throw Errors.unauthorized('Invalid install state');

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!workspace) throw Errors.notFound('Workspace not found');

    const gh = await github.getInstallation(q.installation_id);
    const repositories = await listSelectedRepos(github, q.installation_id, gh.repository_selection);

    await prisma.githubInstallation.upsert({
      where: { installationId: q.installation_id },
      create: {
        workspaceId,
        installationId: q.installation_id,
        accountLogin: gh.account?.login ?? 'unknown',
        accountType: gh.account?.type === 'Organization' ? GithubAccountType.ORGANIZATION : GithubAccountType.USER,
        accountId: gh.account ? String(gh.account.id) : null,
        repositorySelection: gh.repository_selection,
        repositories,
      },
      update: {
        workspaceId,
        accountLogin: gh.account?.login ?? 'unknown',
        accountType: gh.account?.type === 'Organization' ? GithubAccountType.ORGANIZATION : GithubAccountType.USER,
        accountId: gh.account ? String(gh.account.id) : null,
        repositorySelection: gh.repository_selection,
        repositories,
        suspendedAt: null,
      },
    });

    await audit({
      workspaceId,
      action: 'github_app.install',
      targetType: 'github_installation',
      targetId: q.installation_id,
      metadata: { account: gh.account?.login, setupAction: q.setup_action },
    });

    reply.redirect(`${config.PUBLIC_WEB_URL}/dashboard/cicd?installed=1`);
  });

  // List installations in a workspace.
  app.get('/workspaces/:wid/github/installations', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.GITHUB_APP_MANAGE);
    const installations = await prisma.githubInstallation.findMany({
      where: { workspaceId: wid },
      orderBy: { createdAt: 'desc' },
    });
    return { installations: installations.map(toGithubInstallationDTO) };
  });

  // List repositories accessible to an installation.
  app.get('/github/installations/:id/repos', async (req) => {
    const { id } = req.params as { id: string };
    const { installation, workspaceId } = await installationWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.GITHUB_APP_MANAGE);
    const token = await github.createInstallationToken(installation.installationId);
    const repos = await github.listInstallationRepos(token);
    return {
      repos: repos.map((r) => ({
        externalId: String(r.id),
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        url: r.html_url,
      })),
    };
  });

  // Remove an installation record (does not uninstall the App on GitHub).
  app.delete('/github/installations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { installation, workspaceId } = await installationWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.GITHUB_APP_MANAGE);
    await prisma.githubInstallation.delete({ where: { id } });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'github_app.remove',
      targetType: 'github_installation',
      targetId: installation.installationId,
    });
    reply.status(204).send();
  });
}

/** For "selected" installations, resolve full_names via an installation token. */
async function listSelectedRepos(
  github: import('../lib/github.js').GithubClient,
  installationId: string,
  selection: string,
): Promise<string[]> {
  if (selection !== 'selected') return [];
  try {
    const token = await github.createInstallationToken(installationId);
    const repos = await github.listInstallationRepos(token);
    return repos.map((r) => r.full_name);
  } catch {
    return [];
  }
}
