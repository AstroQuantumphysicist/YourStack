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
  UNREACHABLE: 'unreachable',
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
  // Managed resources
  PROVISION_DATABASE: 'PROVISION_DATABASE',
  STOP_DATABASE: 'STOP_DATABASE',
  REMOVE_DATABASE: 'REMOVE_DATABASE',
  BACKUP_DATABASE: 'BACKUP_DATABASE',
  PROVISION_STORAGE: 'PROVISION_STORAGE',
  REMOVE_STORAGE: 'REMOVE_STORAGE',
  DEPLOY_FUNCTION: 'DEPLOY_FUNCTION',
  INVOKE_FUNCTION: 'INVOKE_FUNCTION',
  REMOVE_FUNCTION: 'REMOVE_FUNCTION',
  REGISTER_RUNNER: 'REGISTER_RUNNER',
  DEREGISTER_RUNNER: 'DEREGISTER_RUNNER',
  SCALE_APP: 'SCALE_APP',
  // v3: scheduled jobs run a container to completion.
  RUN_JOB: 'RUN_JOB',
  // v4: networking + node administration
  CONFIGURE_FIREWALL: 'CONFIGURE_FIREWALL',
  PROVISION_LB: 'PROVISION_LB',
  REMOVE_LB: 'REMOVE_LB',
  NODE_REBOOT: 'NODE_REBOOT',
  DOCKER_PRUNE: 'DOCKER_PRUNE',
  AGENT_UPDATE: 'AGENT_UPDATE',
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

/* ------------------------- Managed resources (v2) --------------------------- */

/** Databases users provision with a click ("Data" in the product UI). */
export const DatabaseEngine = {
  POSTGRES: 'postgres',
  MYSQL: 'mysql',
  REDIS: 'redis',
  MONGODB: 'mongodb',
} as const;
export type DatabaseEngine = (typeof DatabaseEngine)[keyof typeof DatabaseEngine];

export const DatabaseStatus = {
  PROVISIONING: 'provisioning',
  RUNNING: 'running',
  STOPPED: 'stopped',
  BACKING_UP: 'backing_up',
  FAILED: 'failed',
} as const;
export type DatabaseStatus = (typeof DatabaseStatus)[keyof typeof DatabaseStatus];

/** S3-compatible object storage ("Buckets" in the product UI). */
export const BucketStatus = {
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  FAILED: 'failed',
} as const;
export type BucketStatus = (typeof BucketStatus)[keyof typeof BucketStatus];

/** Serverless functions ("Functions"). */
export const FunctionRuntime = {
  NODE20: 'node20',
  PYTHON311: 'python311',
  GO122: 'go122',
  BUN1: 'bun1',
} as const;
export type FunctionRuntime = (typeof FunctionRuntime)[keyof typeof FunctionRuntime];

export const FunctionStatus = {
  IDLE: 'idle',
  DEPLOYING: 'deploying',
  ACTIVE: 'active',
  FAILED: 'failed',
} as const;
export type FunctionStatus = (typeof FunctionStatus)[keyof typeof FunctionStatus];

/** Self-hosted CI runner pools (YourStack runs GitHub Actions jobs on user nodes). */
export const RunnerStatus = {
  REGISTERING: 'registering',
  IDLE: 'idle',
  BUSY: 'busy',
  OFFLINE: 'offline',
} as const;
export type RunnerStatus = (typeof RunnerStatus)[keyof typeof RunnerStatus];

/** Autoscaling ("Scale"). */
export const ScalingMetric = {
  CPU: 'cpu',
  MEMORY: 'memory',
  RPS: 'rps',
  LATENCY: 'latency',
} as const;
export type ScalingMetric = (typeof ScalingMetric)[keyof typeof ScalingMetric];

/** Time-series metric kinds reported by the agent per container/app/node. */
export const MetricKind = {
  CPU_PERCENT: 'cpu_percent',
  MEM_MB: 'mem_mb',
  MEM_PERCENT: 'mem_percent',
  RPS: 'rps',
  LATENCY_MS: 'latency_ms',
  NET_RX_KB: 'net_rx_kb',
  NET_TX_KB: 'net_tx_kb',
  DISK_MB: 'disk_mb',
  REPLICAS: 'replicas',
} as const;
export type MetricKind = (typeof MetricKind)[keyof typeof MetricKind];

/** What a metric series is scoped to. */
export const MetricScope = {
  APP: 'app',
  NODE: 'node',
  DATABASE: 'database',
  FUNCTION: 'function',
} as const;
export type MetricScope = (typeof MetricScope)[keyof typeof MetricScope];

/* ----------------------------- v3: marketplace ------------------------------ */

/** Template marketplace categories — "host everything" one-click. */
export const TemplateCategory = {
  DATABASE: 'database',
  CACHE: 'cache',
  QUEUE: 'queue',
  SEARCH: 'search',
  CMS: 'cms',
  ANALYTICS: 'analytics',
  AUTOMATION: 'automation',
  DEVTOOLS: 'devtools',
  MONITORING: 'monitoring',
  STORAGE: 'storage',
  AI: 'ai',
  WEBSITE: 'website',
  PRODUCTIVITY: 'productivity',
  GAME: 'game',
  OTHER: 'other',
} as const;
export type TemplateCategory = (typeof TemplateCategory)[keyof typeof TemplateCategory];

/** What kind of resource a template provisions. */
export const TemplateKind = {
  APP: 'app', // a container/service (arbitrary image)
  DATABASE: 'database',
  FUNCTION: 'function',
  STACK: 'stack', // multiple services deployed together
} as const;
export type TemplateKind = (typeof TemplateKind)[keyof typeof TemplateKind];

export const CronJobStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  RUNNING: 'running',
  FAILED: 'failed',
} as const;
export type CronJobStatus = (typeof CronJobStatus)[keyof typeof CronJobStatus];

/** GitHub App installation account type. */
export const GithubAccountType = {
  USER: 'User',
  ORGANIZATION: 'Organization',
} as const;
export type GithubAccountType = (typeof GithubAccountType)[keyof typeof GithubAccountType];

/* ------------------------------ v4: orgs & teams ---------------------------- */

/** Organization-level role (top tenant). */
export const OrgRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;
export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole];

export const ORG_ROLE_RANK: Record<OrgRole, number> = { owner: 2, admin: 1, member: 0 };

/** Team role within an organization. */
export const TeamRole = {
  LEAD: 'lead',
  MEMBER: 'member',
} as const;
export type TeamRole = (typeof TeamRole)[keyof typeof TeamRole];

/* ------------------------------ v4: networking ------------------------------ */

export const FirewallStatus = {
  DRAFT: 'draft',
  APPLYING: 'applying',
  ACTIVE: 'active',
  FAILED: 'failed',
} as const;
export type FirewallStatus = (typeof FirewallStatus)[keyof typeof FirewallStatus];

export const FirewallAction = {
  ALLOW: 'allow',
  DENY: 'deny',
} as const;
export type FirewallAction = (typeof FirewallAction)[keyof typeof FirewallAction];

export const FirewallProtocol = {
  TCP: 'tcp',
  UDP: 'udp',
  ICMP: 'icmp',
  ANY: 'any',
} as const;
export type FirewallProtocol = (typeof FirewallProtocol)[keyof typeof FirewallProtocol];

export const FirewallDirection = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
} as const;
export type FirewallDirection = (typeof FirewallDirection)[keyof typeof FirewallDirection];

export const LoadBalancerStatus = {
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  FAILED: 'failed',
} as const;
export type LoadBalancerStatus = (typeof LoadBalancerStatus)[keyof typeof LoadBalancerStatus];

export const LBAlgorithm = {
  ROUND_ROBIN: 'round_robin',
  LEAST_CONN: 'least_conn',
  IP_HASH: 'ip_hash',
} as const;
export type LBAlgorithm = (typeof LBAlgorithm)[keyof typeof LBAlgorithm];
