import { z } from 'zod';
import { CommandType } from '../enums.js';
import { resourceSpecSchema } from './common.js';
import {
  provisionDatabaseSpecSchema,
  stopDatabaseSpecSchema,
  removeDatabaseSpecSchema,
  backupDatabaseSpecSchema,
  provisionStorageSpecSchema,
  removeStorageSpecSchema,
  deployFunctionSpecSchema,
  invokeFunctionSpecSchema,
  removeFunctionSpecSchema,
  registerRunnerSpecSchema,
  deregisterRunnerSpecSchema,
  scaleAppSpecSchema,
  runJobSpecSchema,
  configureFirewallSpecSchema,
  provisionLbSpecSchema,
  removeLbSpecSchema,
  nodeRebootSpecSchema,
  dockerPruneSpecSchema,
  agentUpdateSpecSchema,
} from './resources.js';

/**
 * Node command protocol. The control plane enqueues commands; the agent polls,
 * validates against these schemas (the Rust agent mirrors them as serde structs),
 * executes with least privilege, and reports structured results.
 *
 * IMPORTANT: the agent NEVER accepts a free-form shell command. Every command is
 * one of the typed variants below. There is deliberately no `RUN_SHELL` variant.
 */

export const healthcheckSpecSchema = z.object({
  path: z.string().default('/'),
  port: z.number().int().positive(),
  timeoutMs: z.number().int().positive().default(10_000),
  retries: z.number().int().nonnegative().default(5),
  intervalMs: z.number().int().positive().default(3_000),
  expectStatus: z.number().int().min(100).max(599).default(200),
});
export type HealthcheckSpec = z.infer<typeof healthcheckSpecSchema>;

export const portMappingSchema = z.object({
  containerPort: z.number().int().positive(),
  /** Host port; when omitted the agent allocates an ephemeral port. */
  hostPort: z.number().int().positive().optional(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

/** Where the deployable artifact comes from. */
export const deploySourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    image: z.string().min(1),
    /** Optional registry auth (base64 of user:pass) for private images. */
    registryAuth: z.string().optional(),
  }),
  z.object({
    kind: z.literal('git'),
    repoUrl: z.string().url(),
    ref: z.string().min(1),
    /** Path within repo used as Docker build context. */
    contextPath: z.string().default('.'),
    dockerfile: z.string().default('Dockerfile'),
    /** Auth token for cloning private repos (short-lived). */
    cloneToken: z.string().optional(),
  }),
  z.object({
    kind: z.literal('buildpack'),
    repoUrl: z.string().url(),
    ref: z.string().min(1),
    framework: z.enum(['nextjs', 'node', 'python', 'static']),
    installCommand: z.string().optional(),
    buildCommand: z.string().optional(),
    startCommand: z.string().optional(),
    cloneToken: z.string().optional(),
  }),
]);
export type DeploySource = z.infer<typeof deploySourceSchema>;

export const domainConfigSchema = z.object({
  domain: z.string().min(1),
  /** Terminate TLS automatically via Caddy (Let's Encrypt) when true. */
  autoHttps: z.boolean().default(true),
  targetPort: z.number().int().positive(),
});
export type DomainConfig = z.infer<typeof domainConfigSchema>;

/** Full spec the agent needs to bring up a deployment. */
export const deployAppSpecSchema = z.object({
  appId: z.string(),
  deploymentId: z.string(),
  containerName: z.string().min(1),
  imageTag: z.string().min(1),
  source: deploySourceSchema,
  /** Decrypted env injected into the container. Transmitted over TLS only. */
  env: z.record(z.string(), z.string()).default({}),
  ports: z.array(portMappingSchema).default([]),
  resources: resourceSpecSchema,
  healthcheck: healthcheckSpecSchema.optional(),
  domain: domainConfigSchema.optional(),
  strategy: z.enum(['basic_replace', 'rolling']).default('basic_replace'),
  networkName: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
});
export type DeployAppSpec = z.infer<typeof deployAppSpecSchema>;

export const stopAppSpecSchema = z.object({
  appId: z.string(),
  containerName: z.string(),
  /** Grace period before SIGKILL. */
  timeoutSeconds: z.number().int().nonnegative().default(10),
});

export const restartAppSpecSchema = z.object({
  appId: z.string(),
  containerName: z.string(),
});

export const removeAppSpecSchema = z.object({
  appId: z.string(),
  containerName: z.string(),
  removeVolumes: z.boolean().default(false),
  removeImages: z.boolean().default(false),
});

export const streamLogsSpecSchema = z.object({
  appId: z.string(),
  containerName: z.string(),
  /** Tail this many lines before following. */
  tail: z.number().int().nonnegative().default(200),
  follow: z.boolean().default(true),
  sinceSeconds: z.number().int().nonnegative().optional(),
});

export const healthCheckSpecSchema = z.object({
  appId: z.string(),
  containerName: z.string(),
  healthcheck: healthcheckSpecSchema,
});

export const configureDomainSpecSchema = z.object({
  appId: z.string(),
  containerName: z.string(),
  domain: domainConfigSchema,
});

export const rollbackDeploymentSpecSchema = z.object({
  appId: z.string(),
  /** Deployment to roll back TO (must already have an image/spec). */
  targetDeploymentId: z.string(),
  spec: deployAppSpecSchema,
});

/** Discriminated union of all command payloads. */
export const commandPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(CommandType.DEPLOY_APP), spec: deployAppSpecSchema }),
  z.object({ type: z.literal(CommandType.STOP_APP), spec: stopAppSpecSchema }),
  z.object({ type: z.literal(CommandType.RESTART_APP), spec: restartAppSpecSchema }),
  z.object({ type: z.literal(CommandType.REMOVE_APP), spec: removeAppSpecSchema }),
  z.object({ type: z.literal(CommandType.STREAM_LOGS), spec: streamLogsSpecSchema }),
  z.object({ type: z.literal(CommandType.HEALTH_CHECK), spec: healthCheckSpecSchema }),
  z.object({ type: z.literal(CommandType.CONFIGURE_DOMAIN), spec: configureDomainSpecSchema }),
  z.object({ type: z.literal(CommandType.ROLLBACK_DEPLOYMENT), spec: rollbackDeploymentSpecSchema }),
  // Managed resources (v2)
  z.object({ type: z.literal(CommandType.PROVISION_DATABASE), spec: provisionDatabaseSpecSchema }),
  z.object({ type: z.literal(CommandType.STOP_DATABASE), spec: stopDatabaseSpecSchema }),
  z.object({ type: z.literal(CommandType.REMOVE_DATABASE), spec: removeDatabaseSpecSchema }),
  z.object({ type: z.literal(CommandType.BACKUP_DATABASE), spec: backupDatabaseSpecSchema }),
  z.object({ type: z.literal(CommandType.PROVISION_STORAGE), spec: provisionStorageSpecSchema }),
  z.object({ type: z.literal(CommandType.REMOVE_STORAGE), spec: removeStorageSpecSchema }),
  z.object({ type: z.literal(CommandType.DEPLOY_FUNCTION), spec: deployFunctionSpecSchema }),
  z.object({ type: z.literal(CommandType.INVOKE_FUNCTION), spec: invokeFunctionSpecSchema }),
  z.object({ type: z.literal(CommandType.REMOVE_FUNCTION), spec: removeFunctionSpecSchema }),
  z.object({ type: z.literal(CommandType.REGISTER_RUNNER), spec: registerRunnerSpecSchema }),
  z.object({ type: z.literal(CommandType.DEREGISTER_RUNNER), spec: deregisterRunnerSpecSchema }),
  z.object({ type: z.literal(CommandType.SCALE_APP), spec: scaleAppSpecSchema }),
  z.object({ type: z.literal(CommandType.RUN_JOB), spec: runJobSpecSchema }),
  // v4: networking + node administration
  z.object({ type: z.literal(CommandType.CONFIGURE_FIREWALL), spec: configureFirewallSpecSchema }),
  z.object({ type: z.literal(CommandType.PROVISION_LB), spec: provisionLbSpecSchema }),
  z.object({ type: z.literal(CommandType.REMOVE_LB), spec: removeLbSpecSchema }),
  z.object({ type: z.literal(CommandType.NODE_REBOOT), spec: nodeRebootSpecSchema }),
  z.object({ type: z.literal(CommandType.DOCKER_PRUNE), spec: dockerPruneSpecSchema }),
  z.object({ type: z.literal(CommandType.AGENT_UPDATE), spec: agentUpdateSpecSchema }),
]);
export type CommandPayload = z.infer<typeof commandPayloadSchema>;

/** The envelope the agent receives when polling. */
export const nodeCommandSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  payload: commandPayloadSchema,
  timeoutMs: z.number().int().positive(),
  issuedAt: z.string(),
  /** HMAC signature over the canonical JSON of {id,nodeId,payload,timeoutMs,issuedAt}. */
  signature: z.string(),
});
export type NodeCommand = z.infer<typeof nodeCommandSchema>;

export const commandPollResponseSchema = z.object({
  commands: z.array(nodeCommandSchema),
});
export type CommandPollResponse = z.infer<typeof commandPollResponseSchema>;

/** Structured result the agent posts back for a command. */
export const commandResultSchema = z.object({
  commandId: z.string(),
  status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'timed_out']),
  /** Free-form structured output (e.g. container id, image digest, health result). */
  output: z
    .object({
      message: z.string().optional(),
      containerId: z.string().optional(),
      imageDigest: z.string().optional(),
      hostPort: z.number().int().optional(),
      healthy: z.boolean().optional(),
      exitCode: z.number().int().optional(),
      durationMs: z.number().int().optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .default({}),
  error: z.string().optional(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;
