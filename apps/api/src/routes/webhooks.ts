import type { FastifyInstance } from 'fastify';
import { verifyGithubWebhook } from '@yourstack/security';
import { GithubAccountType, QUEUE_NAMES, type WebhookJob } from '@yourstack/shared';
import { Errors } from '../lib/errors.js';
import { triggerDeployment } from '../services/deployment.service.js';

/**
 * GitHub webhook receiver. Verifies the HMAC signature over the RAW body,
 * persists the delivery, and enqueues it for the worker to process (creating
 * pipeline runs / preview deployments). Returns 200 quickly.
 */
export default async function webhookRoutes(app: FastifyInstance) {
  const { prisma, queues, config } = app.ctx;

  app.post('/webhooks/github', async (req, reply) => {
    if (!config.githubWebhookConfigured) {
      throw Errors.badRequest('GitHub webhooks are not configured');
    }
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyGithubWebhook(raw, signature, config.GITHUB_WEBHOOK_SECRET!)) {
      throw Errors.unauthorized('Invalid webhook signature');
    }

    const event = (req.headers['x-github-event'] as string) ?? 'unknown';
    const deliveryId = (req.headers['x-github-delivery'] as string) ?? `local-${Date.now()}`;
    const payload = req.body as Record<string, unknown>;

    // Ping event — acknowledge.
    if (event === 'ping') return { ok: true, pong: true };

    const repoFullName = (payload.repository as { full_name?: string } | undefined)?.full_name;
    const repo = repoFullName
      ? await prisma.gitRepository.findFirst({ where: { fullName: repoFullName } })
      : null;
    if (!repo) {
      // Unknown repo — accept but ignore.
      return { ok: true, ignored: 'repo_not_connected' };
    }

    const ref = (payload.ref as string | undefined) ?? null;
    const commitSha =
      (payload.after as string | undefined) ??
      ((payload.pull_request as { head?: { sha?: string } } | undefined)?.head?.sha ?? null);

    const existing = await prisma.gitWebhook.findUnique({ where: { deliveryId } });
    if (existing) return { ok: true, duplicate: true };

    const webhook = await prisma.gitWebhook.create({
      data: {
        repositoryId: repo.id,
        event,
        deliveryId,
        action: (payload.action as string | undefined) ?? null,
        ref,
        commitSha,
        payload: payload as never,
      },
    });

    const job: WebhookJob = { webhookId: webhook.id };
    await queues.webhook.add(QUEUE_NAMES.WEBHOOK, job, { removeOnComplete: 500, removeOnFail: 500 });

    reply.status(202);
    return { ok: true, webhookId: webhook.id };
  });

  /**
   * GitHub App webhook receiver. Verified with the App webhook secret. Handles
   * installation lifecycle (sync the local record) and `push` events (deploy any
   * app wired to the pushed repo + branch, with best-effort check runs).
   */
  app.post('/webhooks/github-app', async (req, reply) => {
    const { github, realtime } = app.ctx;
    if (!config.githubAppConfigured || !config.GITHUB_APP_WEBHOOK_SECRET) {
      throw Errors.badRequest('GitHub App is not configured');
    }
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyGithubWebhook(raw, signature, config.GITHUB_APP_WEBHOOK_SECRET)) {
      throw Errors.unauthorized('Invalid webhook signature');
    }

    const event = (req.headers['x-github-event'] as string) ?? 'unknown';
    const payload = (req.body ?? {}) as Record<string, unknown>;
    if (event === 'ping') return { ok: true, pong: true };

    if (event === 'installation' || event === 'installation_repositories') {
      await syncInstallation(prisma, payload);
      return { ok: true, synced: true };
    }

    if (event === 'push') {
      const deployed = await handlePush(
        prisma,
        queues.deploy,
        github,
        realtime,
        config.PUBLIC_API_URL,
        payload,
        req.log,
      );
      reply.status(202);
      return { ok: true, deployments: deployed };
    }

    return { ok: true, ignored: event };
  });
}

/** Upsert/delete the local GithubInstallation record from an app webhook. */
async function syncInstallation(
  prisma: import('@yourstack/db').PrismaClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const installation = payload.installation as
    | { id?: number; account?: { login?: string; id?: number; type?: string }; repository_selection?: string }
    | undefined;
  if (!installation?.id) return;
  const installationId = String(installation.id);
  const action = payload.action as string | undefined;

  if (action === 'deleted') {
    await prisma.githubInstallation.deleteMany({ where: { installationId } });
    return;
  }

  const existing = await prisma.githubInstallation.findUnique({ where: { installationId } });
  if (!existing) return; // Not linked to a workspace yet (install handled via callback).

  // Recompute selected repositories from add/remove or the full list.
  let repositories = existing.repositories;
  const added = (payload.repositories_added ?? payload.repositories) as
    | Array<{ full_name?: string }>
    | undefined;
  const removed = payload.repositories_removed as Array<{ full_name?: string }> | undefined;
  if (Array.isArray(added) && payload.repositories) {
    repositories = added.map((r) => r.full_name).filter((n): n is string => Boolean(n));
  } else {
    if (Array.isArray(added)) {
      const names = added.map((r) => r.full_name).filter((n): n is string => Boolean(n));
      repositories = Array.from(new Set([...repositories, ...names]));
    }
    if (Array.isArray(removed)) {
      const drop = new Set(removed.map((r) => r.full_name));
      repositories = repositories.filter((n) => !drop.has(n));
    }
  }

  await prisma.githubInstallation.update({
    where: { installationId },
    data: {
      repositorySelection: installation.repository_selection ?? existing.repositorySelection,
      repositories,
      accountType:
        installation.account?.type === 'Organization'
          ? GithubAccountType.ORGANIZATION
          : existing.accountType,
      suspendedAt: action === 'suspend' ? new Date() : action === 'unsuspend' ? null : existing.suspendedAt,
    },
  });
}

/** Deploy every app wired to the pushed repo+branch; best-effort check runs. */
async function handlePush(
  prisma: import('@yourstack/db').PrismaClient,
  deployQueue: import('bullmq').Queue,
  github: import('../lib/github.js').GithubClient,
  realtime: import('../realtime/hub.js').RealtimeHub,
  publicApiUrl: string,
  payload: Record<string, unknown>,
  log: import('fastify').FastifyBaseLogger,
): Promise<number> {
  const fullName = (payload.repository as { full_name?: string } | undefined)?.full_name;
  const ref = payload.ref as string | undefined;
  const headSha = payload.after as string | undefined;
  const installationId = (payload.installation as { id?: number } | undefined)?.id;
  if (!fullName || !ref?.startsWith('refs/heads/')) return 0;
  const branch = ref.slice('refs/heads/'.length);

  const repo = await prisma.gitRepository.findFirst({ where: { fullName } });
  if (!repo) return 0;
  const apps = await prisma.app.findMany({
    where: { gitRepositoryId: repo.id, branch, deletedAt: null },
  });
  if (apps.length === 0) return 0;

  // Mint an installation token once for best-effort check runs.
  let token: string | null = null;
  if (installationId) {
    try {
      token = await github.createInstallationToken(installationId);
    } catch (err) {
      log.warn({ err }, 'failed to mint installation token for check run');
    }
  }

  let count = 0;
  for (const appRow of apps) {
    if (token && headSha) {
      await github
        .createCheckRun(token, fullName, headSha, 'yourstack/deploy', {
          status: 'in_progress',
          title: 'YourStack deploy',
          summary: `Deploying ${appRow.name} from ${branch}…`,
          detailsUrl: `${publicApiUrl}/v1/apps/${appRow.id}`,
        })
        .catch((err) => log.warn({ err }, 'failed to create pending check run'));
    }
    try {
      await triggerDeployment(prisma, deployQueue, realtime, {
        appId: appRow.id,
        triggeredBy: 'github-app',
        ref: branch,
        commitSha: headSha,
        commitMessage: (payload.head_commit as { message?: string } | undefined)?.message,
      });
      count++;
    } catch (err) {
      log.warn({ err, appId: appRow.id }, 'push-triggered deploy failed');
      if (token && headSha) {
        await github
          .createCheckRun(token, fullName, headSha, 'yourstack/deploy', {
            status: 'completed',
            conclusion: 'failure',
            title: 'YourStack deploy',
            summary: err instanceof Error ? err.message : 'Deploy failed to enqueue',
          })
          .catch(() => undefined);
      }
    }
  }
  return count;
}
