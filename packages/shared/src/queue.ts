import { z } from 'zod';

/**
 * BullMQ queue + job contracts. The API enqueues; the worker processes. Keeping
 * the queue names and job payload schemas here guarantees both sides agree.
 */
export const QUEUE_NAMES = {
  DEPLOY: 'yourstack.deploy',
  PIPELINE: 'yourstack.pipeline',
  WEBHOOK: 'yourstack.webhook',
  HEALTHCHECK: 'yourstack.healthcheck',
  ROLLBACK: 'yourstack.rollback',
  DOMAIN: 'yourstack.domain',
  MAINTENANCE: 'yourstack.maintenance',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** A deployment was requested; worker resolves spec, enqueues pipeline/dispatches command. */
export const deployJobSchema = z.object({
  deploymentId: z.string(),
  appId: z.string(),
  triggeredBy: z.string(),
  ref: z.string().optional(),
});
export type DeployJob = z.infer<typeof deployJobSchema>;

/** Run the CI/CD pipeline for a deployment. */
export const pipelineJobSchema = z.object({
  pipelineRunId: z.string(),
  deploymentId: z.string(),
  appId: z.string(),
  trigger: z.enum(['push', 'pull_request', 'manual']),
  ref: z.string().optional(),
  commitSha: z.string().optional(),
});
export type PipelineJob = z.infer<typeof pipelineJobSchema>;

/** A stored GitHub webhook delivery to process. */
export const webhookJobSchema = z.object({
  webhookId: z.string(),
});
export type WebhookJob = z.infer<typeof webhookJobSchema>;

/** Run a healthcheck against a running deployment (via node command). */
export const healthcheckJobSchema = z.object({
  deploymentId: z.string(),
  appId: z.string(),
  attempt: z.number().int().default(0),
});
export type HealthcheckJob = z.infer<typeof healthcheckJobSchema>;

/** Roll an app back to a previous deployment. */
export const rollbackJobSchema = z.object({
  appId: z.string(),
  targetDeploymentId: z.string(),
  triggeredBy: z.string(),
});
export type RollbackJob = z.infer<typeof rollbackJobSchema>;

/** Verify a custom domain's DNS + configure proxy on the node. */
export const domainJobSchema = z.object({
  domainId: z.string(),
  attempt: z.number().int().default(0),
});
export type DomainJob = z.infer<typeof domainJobSchema>;

/** Scheduled maintenance job kinds (repeatable). */
export const maintenanceJobSchema = z.object({
  kind: z.enum(['log_retention', 'node_liveness', 'cleanup', 'usage_rollup']),
});
export type MaintenanceJob = z.infer<typeof maintenanceJobSchema>;
