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
