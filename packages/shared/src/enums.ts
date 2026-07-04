/**
 * Canonical status enums shared across API, worker, agent (via generated JSON),
 * web, and CLI. Modeled as const objects so they double as runtime values and
 * union types, and align 1:1 with the Prisma string columns in @yourstack/db.
 */

export const WorkspaceRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];
export const WORKSPACE_ROLES = Object.values(WorkspaceRole);

/** Ordered from most to least privileged for comparison helpers. */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  developer: 1,
  viewer: 0,
};

export const AppStatus = {
  IDLE: 'idle',
  BUILDING: 'building',
  DEPLOYING: 'deploying',
  RUNNING: 'running',
  FAILED: 'failed',
  STOPPED: 'stopped',
} as const;
export type AppStatus = (typeof AppStatus)[keyof typeof AppStatus];

export const NodeStatus = {
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  DRAINING: 'draining',
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

export const DeploymentStatus = {
  QUEUED: 'queued',
  BUILDING: 'building',
  DEPLOYING: 'deploying',
  RUNNING: 'running',
  FAILED: 'failed',
  STOPPED: 'stopped',
  ROLLED_BACK: 'rolled_back',
  SUPERSEDED: 'superseded',
} as const;
export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

/** Terminal deployment states (no further transitions expected). */
export const TERMINAL_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  DeploymentStatus.RUNNING,
  DeploymentStatus.FAILED,
  DeploymentStatus.STOPPED,
  DeploymentStatus.ROLLED_BACK,
  DeploymentStatus.SUPERSEDED,
];

export const PipelineRunStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
} as const;
export type PipelineRunStatus = (typeof PipelineRunStatus)[keyof typeof PipelineRunStatus];

export const PipelineStageName = {
  CHECKOUT: 'checkout',
  INSTALL: 'install',
  TEST: 'test',
  BUILD: 'build',
  PACKAGE: 'package',
  DEPLOY: 'deploy',
  HEALTHCHECK: 'healthcheck',
  FINALIZE: 'finalize',
} as const;
export type PipelineStageName = (typeof PipelineStageName)[keyof typeof PipelineStageName];

export const PIPELINE_STAGE_ORDER: PipelineStageName[] = [
  PipelineStageName.CHECKOUT,
  PipelineStageName.INSTALL,
  PipelineStageName.TEST,
  PipelineStageName.BUILD,
  PipelineStageName.PACKAGE,
  PipelineStageName.DEPLOY,
  PipelineStageName.HEALTHCHECK,
  PipelineStageName.FINALIZE,
];

export const StageStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;
export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

/** Node command lifecycle, mirrored by the Rust agent. */
export const CommandStatus = {
  QUEUED: 'queued',
  ACCEPTED: 'accepted',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
} as const;
export type CommandStatus = (typeof CommandStatus)[keyof typeof CommandStatus];

export const TERMINAL_COMMAND_STATUSES: CommandStatus[] = [
  CommandStatus.SUCCEEDED,
  CommandStatus.FAILED,
  CommandStatus.TIMED_OUT,
];

export const CommandType = {
  DEPLOY_APP: 'DEPLOY_APP',
  STOP_APP: 'STOP_APP',
  RESTART_APP: 'RESTART_APP',
  REMOVE_APP: 'REMOVE_APP',
  STREAM_LOGS: 'STREAM_LOGS',
  HEALTH_CHECK: 'HEALTH_CHECK',
  CONFIGURE_DOMAIN: 'CONFIGURE_DOMAIN',
  ROLLBACK_DEPLOYMENT: 'ROLLBACK_DEPLOYMENT',
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

export const AppFramework = {
  NEXTJS: 'nextjs',
  NODE: 'node',
  PYTHON: 'python',
  DOCKERFILE: 'dockerfile',
  STATIC: 'static',
} as const;
export type AppFramework = (typeof AppFramework)[keyof typeof AppFramework];

export const DeploymentStrategy = {
  BASIC_REPLACE: 'basic_replace',
  ROLLING: 'rolling',
} as const;
export type DeploymentStrategy = (typeof DeploymentStrategy)[keyof typeof DeploymentStrategy];

export const DomainStatus = {
  PENDING: 'pending',
  VERIFYING: 'verifying',
  VERIFIED: 'verified',
  ACTIVE: 'active',
  FAILED: 'failed',
} as const;
export type DomainStatus = (typeof DomainStatus)[keyof typeof DomainStatus];

export const SecretScope = {
  PROJECT: 'project',
  APP: 'app',
  ENVIRONMENT: 'environment',
} as const;
export type SecretScope = (typeof SecretScope)[keyof typeof SecretScope];

export const LogSeverity = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;
export type LogSeverity = (typeof LogSeverity)[keyof typeof LogSeverity];

export const LogStream = {
  BUILD: 'build',
  RUNTIME: 'runtime',
  SYSTEM: 'system',
} as const;
export type LogStream = (typeof LogStream)[keyof typeof LogStream];

export const WorkspaceStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;
export type WorkspaceStatus = (typeof WorkspaceStatus)[keyof typeof WorkspaceStatus];

export const EnvironmentType = {
  PRODUCTION: 'production',
  PREVIEW: 'preview',
  DEVELOPMENT: 'development',
} as const;
export type EnvironmentType = (typeof EnvironmentType)[keyof typeof EnvironmentType];
