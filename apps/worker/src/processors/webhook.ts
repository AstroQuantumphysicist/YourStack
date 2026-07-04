import type { Job } from 'bullmq';
import { webhookJobSchema } from '@noderail/shared';
import { randomToken } from '@noderail/security';
import type { WorkerContext } from '../context.js';
import { createDeployment } from '../lib/deploy.js';
import { logger } from '../logger.js';

/**
 * Process a stored GitHub webhook delivery. On push to a configured branch,
 * create + enqueue a deployment for every matching app. On pull_request
 * open/sync, create a preview deployment with a generated preview domain.
 */
export async function processWebhook(ctx: WorkerContext, job: Job): Promise<void> {
  const { webhookId } = webhookJobSchema.parse(job.data);
  const { prisma, config } = ctx;

  const webhook = await prisma.gitWebhook.findUnique({ where: { id: webhookId }, include: { repository: true } });
  if (!webhook || webhook.processed) return;
  const payload = webhook.payload as Record<string, unknown>;

  try {
    if (webhook.event === 'push') {
      const branch = (webhook.ref ?? '').replace('refs/heads/', '');
      const apps = await prisma.app.findMany({
        where: { gitRepositoryId: webhook.repositoryId, branch, deletedAt: null },
      });
      const headCommit = payload.head_commit as { message?: string } | undefined;
      for (const app of apps) {
        const result = await createDeployment(ctx, {
          app,
          triggeredBy: 'webhook',
          ref: branch,
          commitSha: webhook.commitSha ?? undefined,
          commitMessage: headCommit?.message,
        });
        logger.info({ appId: app.id, result }, 'webhook triggered deployment');
      }
    } else if (webhook.event === 'pull_request' && ['opened', 'synchronize', 'reopened'].includes(webhook.action ?? '')) {
      const pr = payload.pull_request as { number?: number; head?: { ref?: string; sha?: string } } | undefined;
      const apps = await prisma.app.findMany({
        where: { gitRepositoryId: webhook.repositoryId, deletedAt: null },
      });
      for (const app of apps) {
        // Ensure a preview domain exists for this app.
        const hostname = `${app.id.slice(-8)}-pr${pr?.number ?? 0}.${config.BASE_PREVIEW_DOMAIN}`;
        await prisma.domain.upsert({
          where: { hostname },
          create: {
            appId: app.id,
            hostname,
            status: 'pending',
            isPreview: true,
            verificationToken: `noderail-verify=${randomToken(12)}`,
            dnsTarget: hostname,
          },
          update: {},
        });
        await createDeployment(ctx, {
          app,
          triggeredBy: 'webhook',
          ref: pr?.head?.ref ?? app.branch,
          commitSha: pr?.head?.sha,
          reason: `Preview for PR #${pr?.number}`,
        });
      }
    }
  } finally {
    await prisma.gitWebhook.update({ where: { id: webhookId }, data: { processed: true } });
  }
}
