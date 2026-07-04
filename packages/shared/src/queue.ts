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
  // Managed resources (v2)
  DATABASE: 'yourstack.database',
  STORAGE: 'yourstack.storage',
  FUNCTION: 'yourstack.function',
  RUNNER: 'yourstack.runner',
  AUTOSCALE: 'yourstack.autoscale',
  CRON: 'yourstack.cron',
  FIREWALL: 'yourstack.firewall',
  LOADBALANCER: 'yourstack.loadbalancer',
  NODE_ADMIN: 'yourstack.nodeadmin',
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
  kind: z.enum(['log_retention', 'node_liveness', 'cleanup', 'usage_rollup', 'metric_rollup']),
});
export type MaintenanceJob = z.infer<typeof maintenanceJobSchema>;

/* ----------------------- Managed-resource jobs (v2) ------------------------- */

export const databaseJobSchema = z.object({
  databaseId: z.string(),
  action: z.enum(['provision', 'stop', 'remove', 'backup']),
  triggeredBy: z.string().optional(),
});
export type DatabaseJob = z.infer<typeof databaseJobSchema>;

export const storageJobSchema = z.object({
  bucketId: z.string(),
  action: z.enum(['provision', 'remove']),
  triggeredBy: z.string().optional(),
});
export type StorageJob = z.infer<typeof storageJobSchema>;

export const functionJobSchema = z.object({
  functionId: z.string(),
  action: z.enum(['deploy', 'remove']),
  triggeredBy: z.string().optional(),
});
export type FunctionJob = z.infer<typeof functionJobSchema>;

export const runnerJobSchema = z.object({
  poolId: z.string(),
  action: z.enum(['scale', 'register', 'deregister']),
  desired: z.number().int().nonnegative().optional(),
});
export type RunnerJob = z.infer<typeof runnerJobSchema>;

/** Evaluate an app's scaling policy against recent metrics and reconcile replicas. */
export const autoscaleJobSchema = z.object({
  appId: z.string(),
});
export type AutoscaleJob = z.infer<typeof autoscaleJobSchema>;

/** Fire a cron job (repeatable per-cron schedule → one container run). */
export const cronJobSchema = z.object({
  cronJobId: z.string(),
});
export type CronJob = z.infer<typeof cronJobSchema>;

/* ------------------------------- v4 jobs ------------------------------------ */

export const firewallJobSchema = z.object({ firewallId: z.string(), action: z.enum(['apply', 'remove']) });
export type FirewallJob = z.infer<typeof firewallJobSchema>;

export const loadBalancerJobSchema = z.object({ loadBalancerId: z.string(), action: z.enum(['provision', 'remove', 'reconcile']) });
export type LoadBalancerJob = z.infer<typeof loadBalancerJobSchema>;

export const nodeAdminJobSchema = z.object({
  nodeId: z.string(),
  action: z.enum(['reboot', 'docker_prune', 'agent_update']),
  version: z.string().optional(),
});
export type NodeAdminJob = z.infer<typeof nodeAdminJobSchema>;
