import { z } from 'zod';
import {
  AppFramework,
  DeploymentStrategy,
  EnvironmentType,
  SecretScope,
  WorkspaceRole,
} from '../enums.js';
import { resourceSpecSchema, slugSchema } from './common.js';

/* --------------------------------- Workspaces -------------------------------- */

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(64),
  slug: slugSchema.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(64).optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    WorkspaceRole.ADMIN,
    WorkspaceRole.DEVELOPER,
    WorkspaceRole.VIEWER,
  ]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum([
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.DEVELOPER,
    WorkspaceRole.VIEWER,
  ]),
});

/* ---------------------------------- Projects --------------------------------- */

export const createProjectSchema = z.object({
  name: z.string().min(2).max(64),
  slug: slugSchema.optional(),
  description: z.string().max(500).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(64).optional(),
  description: z.string().max(500).optional(),
});

/* ------------------------------------ Apps ----------------------------------- */

export const createAppSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(64),
  slug: slugSchema.optional(),
  repoUrl: z.string().url().optional(),
  gitRepositoryId: z.string().optional(),
  branch: z.string().default('main'),
  framework: z
    .enum([
      AppFramework.NEXTJS,
      AppFramework.NODE,
      AppFramework.PYTHON,
      AppFramework.DOCKERFILE,
      AppFramework.STATIC,
    ])
    .optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  installCommand: z.string().optional(),
  port: z.number().int().positive().default(3000),
  resources: resourceSpecSchema.optional(),
  deploymentStrategy: z
    .enum([DeploymentStrategy.BASIC_REPLACE, DeploymentStrategy.ROLLING])
    .default(DeploymentStrategy.BASIC_REPLACE),
  nodeId: z.string().optional(),
  healthcheckPath: z.string().default('/'),
});
export type CreateAppInput = z.infer<typeof createAppSchema>;

export const updateAppSchema = createAppSchema.partial().omit({ projectId: true });

export const deployAppRequestSchema = z.object({
  /** Optional git ref override; defaults to the app's configured branch. */
  ref: z.string().optional(),
  environmentId: z.string().optional(),
  reason: z.string().max(200).optional(),
});
export type DeployAppRequest = z.infer<typeof deployAppRequestSchema>;

export const rollbackRequestSchema = z.object({
  targetDeploymentId: z.string(),
});

/* ---------------------------------- Nodes ------------------------------------ */

export const createJoinTokenSchema = z.object({
  label: z.string().max(64).optional(),
  region: z.string().max(64).optional(),
});
export type CreateJoinTokenInput = z.infer<typeof createJoinTokenSchema>;

/** Agent -> API registration using a one-time join token. */
export const nodeRegisterSchema = z.object({
  joinToken: z.string(),
  name: z.string().min(1).max(120),
  telemetry: z.object({
    agentVersion: z.string(),
    protocolVersion: z.number().int(),
    os: z.string(),
    arch: z.string(),
    cpuCores: z.number().int().nonnegative(),
    memoryTotalMb: z.number().int().nonnegative(),
    diskTotalMb: z.number().int().nonnegative(),
    dockerVersion: z.string().nullable().optional(),
    publicIp: z.string().nullable().optional(),
  }),
});
export type NodeRegisterInput = z.infer<typeof nodeRegisterSchema>;

export const nodeRegisterResponseSchema = z.object({
  nodeId: z.string(),
  /** Long-lived agent auth token. Store securely in agent.toml. */
  agentToken: z.string(),
  /** HMAC key (hex) used to verify command signatures. */
  commandVerifyKey: z.string(),
  heartbeatIntervalMs: z.number().int(),
});
export type NodeRegisterResponse = z.infer<typeof nodeRegisterResponseSchema>;

export const updateNodeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  region: z.string().max(64).optional(),
});

export const nodeLabelSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().max(128),
});

/* ---------------------------------- Secrets ---------------------------------- */

export const createSecretSchema = z.object({
  scope: z.enum([SecretScope.PROJECT, SecretScope.APP, SecretScope.ENVIRONMENT]),
  projectId: z.string().optional(),
  appId: z.string().optional(),
  environmentId: z.string().optional(),
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'must be an uppercase env-var name'),
  value: z.string().min(1).max(32_768),
});
export type CreateSecretInput = z.infer<typeof createSecretSchema>;

export const updateSecretSchema = z.object({
  value: z.string().min(1).max(32_768),
});

/* ---------------------------------- Domains ---------------------------------- */

export const createDomainSchema = z.object({
  appId: z.string(),
  hostname: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+$/, 'invalid hostname'),
});
export type CreateDomainInput = z.infer<typeof createDomainSchema>;

/* --------------------------------- Git repos --------------------------------- */

export const connectRepoSchema = z.object({
  provider: z.literal('github').default('github'),
  externalId: z.string(),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string().default('main'),
  private: z.boolean().default(true),
  installWebhook: z.boolean().default(true),
});
export type ConnectRepoInput = z.infer<typeof connectRepoSchema>;

/* --------------------------------- Environments ------------------------------ */

export const createEnvironmentSchema = z.object({
  appId: z.string(),
  name: z.string().min(1).max(64),
  type: z
    .enum([EnvironmentType.PRODUCTION, EnvironmentType.PREVIEW, EnvironmentType.DEVELOPMENT])
    .default(EnvironmentType.PRODUCTION),
});

/* --------------------------------- API tokens -------------------------------- */

export const createApiTokenSchema = z.object({
  name: z.string().min(1).max(64),
  expiresInDays: z.number().int().positive().max(365).optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

/* --------------------------- Managed resources (v2) ------------------------- */

export const createDatabaseSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(64),
  engine: z.enum(['postgres', 'mysql', 'redis', 'mongodb']),
  version: z.string().default('16'),
  nodeId: z.string().optional(),
  region: z.string().optional(),
  storageMb: z.number().int().positive().max(1_048_576).default(10_240),
  cpu: z.number().positive().max(64).default(1),
  memoryMb: z.number().int().positive().max(262_144).default(1024),
});
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;

export const createBucketSchema = z.object({
  projectId: z.string(),
  name: slugSchema,
  nodeId: z.string().optional(),
  region: z.string().optional(),
  isPublic: z.boolean().default(false),
  quotaMb: z.number().int().positive().max(10_485_760).default(51_200),
});
export type CreateBucketInput = z.infer<typeof createBucketSchema>;

export const createFunctionSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(64),
  runtime: z.enum(['node20', 'python311', 'go122', 'bun1']),
  handler: z.string().default('index.handler'),
  nodeId: z.string().optional(),
  region: z.string().optional(),
  memoryMb: z.number().int().positive().max(4096).default(256),
  timeoutMs: z.number().int().positive().max(900_000).default(30_000),
  minInstances: z.number().int().nonnegative().max(50).default(0),
  code: z.string().optional(),
  repoUrl: z.string().url().optional(),
  branch: z.string().optional(),
});
export type CreateFunctionInput = z.infer<typeof createFunctionSchema>;

export const createRunnerPoolSchema = z.object({
  name: z.string().min(2).max(64),
  githubScope: z.string().min(1), // "owner" or "owner/repo"
  labels: z.array(z.string()).default(['yourstack', 'self-hosted']),
  minRunners: z.number().int().nonnegative().default(0),
  maxRunners: z.number().int().positive().max(100).default(5),
  nodeId: z.string().optional(),
});
export type CreateRunnerPoolInput = z.infer<typeof createRunnerPoolSchema>;

export const updateScalingPolicySchema = z.object({
  enabled: z.boolean(),
  minReplicas: z.number().int().nonnegative().max(100).default(1),
  maxReplicas: z.number().int().positive().max(100).default(3),
  metric: z.enum(['cpu', 'memory', 'rps', 'latency']).default('cpu'),
  targetValue: z.number().positive(),
  cooldownSeconds: z.number().int().positive().max(3600).default(120),
});
export type UpdateScalingPolicyInput = z.infer<typeof updateScalingPolicySchema>;

export const createRegionSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(64),
  country: z.string().max(64).optional(),
  flag: z.string().max(8).optional(),
});
export type CreateRegionInput = z.infer<typeof createRegionSchema>;

/* -------------------------- Marketplace / cron (v3) ------------------------- */

/** Deploy a marketplace template into a project. */
export const deployTemplateSchema = z.object({
  templateSlug: z.string(),
  projectId: z.string(),
  name: z.string().min(2).max(64).optional(),
  nodeId: z.string().optional(),
  region: z.string().optional(),
  /** Override template defaults for exposed variables. */
  variables: z.record(z.string(), z.string()).default({}),
});
export type DeployTemplateInput = z.infer<typeof deployTemplateSchema>;

/** Register a scheduled container job (cron). */
export const createCronJobSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(64),
  /** Standard 5-field cron expression. */
  schedule: z.string().min(9).max(100),
  image: z.string().min(1),
  command: z.string().optional(),
  nodeId: z.string().optional(),
  region: z.string().optional(),
  cpu: z.number().positive().max(32).default(0.5),
  memoryMb: z.number().int().positive().max(65_536).default(512),
  timeoutSeconds: z.number().int().positive().max(86_400).default(600),
});
export type CreateCronJobInput = z.infer<typeof createCronJobSchema>;

export const updateCronJobSchema = z.object({
  schedule: z.string().min(9).max(100).optional(),
  paused: z.boolean().optional(),
});

/* ------------------------------ v4: orgs & teams ---------------------------- */

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(80),
  slug: slugSchema.optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteOrgMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
});

export const createTeamSchema = z.object({
  name: z.string().min(2).max(64),
  slug: slugSchema.optional(),
});

export const addTeamMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['lead', 'member']).default('member'),
});

/** Grant a team access to a workspace at a given role. */
export const grantWorkspaceSchema = z.object({
  teamId: z.string(),
  workspaceId: z.string(),
  role: z.enum(['owner', 'admin', 'developer', 'viewer']).default('developer'),
});

/* ------------------------------- v4: firewalls ------------------------------ */

export const firewallRuleInputSchema = z.object({
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  action: z.enum(['allow', 'deny']).default('allow'),
  protocol: z.enum(['tcp', 'udp', 'icmp', 'any']).default('tcp'),
  port: z.string().optional(),
  cidr: z.string().default('0.0.0.0/0'),
  comment: z.string().max(120).optional(),
});

export const createFirewallSchema = z.object({
  name: z.string().min(2).max(64),
  defaultInbound: z.enum(['allow', 'deny']).default('deny'),
  defaultOutbound: z.enum(['allow', 'deny']).default('allow'),
  nodeIds: z.array(z.string()).default([]),
  rules: z.array(firewallRuleInputSchema).max(200).default([]),
});
export type CreateFirewallInput = z.infer<typeof createFirewallSchema>;

export const updateFirewallSchema = createFirewallSchema.partial();

/* ---------------------------- v4: load balancers ---------------------------- */

export const createLoadBalancerSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(64),
  listenPort: z.number().int().positive().default(80),
  algorithm: z.enum(['round_robin', 'least_conn', 'ip_hash']).default('round_robin'),
  nodeId: z.string().optional(),
  region: z.string().optional(),
  /** App ids to balance across, and/or explicit "host:port" targets. */
  appIds: z.array(z.string()).default([]),
  targets: z.array(z.string()).default([]),
  domain: z.string().optional(),
  autoHttps: z.boolean().default(false),
  sticky: z.boolean().default(false),
});
export type CreateLoadBalancerInput = z.infer<typeof createLoadBalancerSchema>;

/* ------------------------------ v4: node admin ------------------------------ */

export const nodeActionSchema = z.object({
  action: z.enum(['reboot', 'docker_prune', 'agent_update']),
  version: z.string().optional(),
});
export type NodeActionInput = z.infer<typeof nodeActionSchema>;

/* -------------------------------- v4: blueprint ----------------------------- */

export const applyBlueprintSchema = z.object({
  workspaceId: z.string(),
  /** Raw yourstack.yaml (YAML or JSON string) OR a parsed object. */
  blueprint: z.unknown(),
  dryRun: z.boolean().default(false),
});
export type ApplyBlueprintInput = z.infer<typeof applyBlueprintSchema>;
