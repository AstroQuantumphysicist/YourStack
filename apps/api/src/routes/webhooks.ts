import type { FastifyInstance } from 'fastify';
import { verifyGithubWebhook } from '@noderail/security';
import { QUEUE_NAMES, type WebhookJob } from '@noderail/shared';
import { Errors } from '../lib/errors.js';

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
}
