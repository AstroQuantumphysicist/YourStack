import type { FastifyInstance } from 'fastify';
import { connectRepoSchema, Permission } from '@yourstack/shared';
import { AuditAction } from '@yourstack/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toRepoDTO } from '../lib/dto.js';

/** Load the caller's GitHub OAuth access token (decrypted). */
async function githubToken(app: FastifyInstance, userId: string): Promise<string> {
  const account = await app.ctx.prisma.oAuthAccount.findFirst({
    where: { userId, provider: 'github' },
  });
  if (!account?.accessToken) throw Errors.badRequest('Connect your GitHub account first');
  return app.ctx.encryptor.decrypt(account.accessToken);
}

export default async function repoRoutes(app: FastifyInstance) {
  const { prisma, github, config, audit } = app.ctx;

  // List the user's GitHub repositories (for the connect UI).
  app.get('/github/repos', async (req) => {
    const user = req.user;
    if (!user) throw Errors.unauthorized();
    const token = await githubToken(app, user.id);
    const repos = await github.listRepos(token);
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

  // List connected repos in a workspace.
  app.get('/workspaces/:wid/repos', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.REPO_VIEW);
    const repos = await prisma.gitRepository.findMany({ where: { workspaceId: wid }, orderBy: { createdAt: 'desc' } });
    return { repos: repos.map(toRepoDTO) };
  });

  // Connect a repo: persist it and (optionally) register a push webhook.
  app.post('/workspaces/:wid/repos', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.REPO_CONNECT);
    const body = parse(connectRepoSchema, req.body);
    const token = await githubToken(app, req.user!.id);

    let webhookId: string | null = null;
    let webhookActive = false;
    if (body.installWebhook && config.githubWebhookConfigured) {
      try {
        webhookId = await github.createWebhook(token, `${body.owner}/${body.name}`, config.GITHUB_WEBHOOK_SECRET!);
        webhookActive = true;
      } catch (err) {
        req.log.warn({ err }, 'failed to create GitHub webhook');
      }
    }

    const repo = await prisma.gitRepository.upsert({
      where: { workspaceId_provider_externalId: { workspaceId: wid, provider: 'github', externalId: body.externalId } },
      create: {
        workspaceId: wid,
        provider: 'github',
        externalId: body.externalId,
        owner: body.owner,
        name: body.name,
        fullName: `${body.owner}/${body.name}`,
        defaultBranch: body.defaultBranch,
        private: body.private,
        installToken: app.ctx.encryptor.encrypt(token),
        webhookId,
        webhookActive,
      },
      update: { installToken: app.ctx.encryptor.encrypt(token), webhookId, webhookActive },
    });
    await audit({
      workspaceId: wid,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.REPO_CONNECT,
      targetType: 'repository',
      targetId: repo.id,
      metadata: { fullName: repo.fullName },
    });
    return { repo: toRepoDTO(repo) };
  });
}
