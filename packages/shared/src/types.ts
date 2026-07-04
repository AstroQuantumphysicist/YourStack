import type {
  AppFramework,
  AppStatus,
  CommandStatus,
  CommandType,
  DeploymentStatus,
  DeploymentStrategy,
  DomainStatus,
  NodeStatus,
  PipelineRunStatus,
  SecretScope,
  StageStatus,
  WorkspaceRole,
} from './enums.js';

/**
 * Serialized DTO shapes returned by the API. These are hand-authored (rather
 * than derived from Prisma) so the web and CLI can depend on @yourstack/shared
 * without pulling in the database client.
 */

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: WorkspaceRole;
  planKey: string;
  createdAt: string;
}

export interface MemberDTO {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

export interface ProjectDTO {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  appCount: number;
  createdAt: string;
}

export interface AppDTO {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  status: AppStatus;
  framework: AppFramework | null;
  repoUrl: string | null;
  branch: string;
  port: number;
  buildCommand: string | null;
  startCommand: string | null;
  installCommand: string | null;
  deploymentStrategy: DeploymentStrategy;
  nodeId: string | null;
  healthcheckPath: string;
  currentDeploymentId: string | null;
  cpu: number;
  memoryMb: number;
  createdAt: string;
  updatedAt: string;
}

export interface NodeDTO {
  id: string;
  workspaceId: string;
  name: string;
  status: NodeStatus;
  region: string | null;
  os: string | null;
  arch: string | null;
  agentVersion: string | null;
  dockerVersion: string | null;
  publicIp: string | null;
  cpuCores: number | null;
  cpuUsagePercent: number | null;
  memoryTotalMb: number | null;
  memoryUsedMb: number | null;
  diskTotalMb: number | null;
  diskUsedMb: number | null;
  lastHeartbeatAt: string | null;
  labels: Array<{ key: string; value: string }>;
  runningAppCount: number;
  createdAt: string;
}

export interface DeploymentDTO {
  id: string;
  appId: string;
  version: number;
  status: DeploymentStatus;
  nodeId: string | null;
  imageTag: string | null;
  ref: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  reason: string | null;
  healthy: boolean | null;
  hostPort: number | null;
  triggeredBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface PipelineRunDTO {
  id: string;
  appId: string;
  deploymentId: string | null;
  status: PipelineRunStatus;
  trigger: string;
  ref: string | null;
  commitSha: string | null;
  stages: Array<{
    name: string;
    status: StageStatus;
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
  }>;
  createdAt: string;
}

export interface SecretDTO {
  id: string;
  scope: SecretScope;
  key: string;
  /** Value is NEVER returned after creation. */
  lastFour: string | null;
  projectId: string | null;
  appId: string | null;
  environmentId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface DomainDTO {
  id: string;
  appId: string;
  hostname: string;
  status: DomainStatus;
  verificationToken: string;
  dnsTarget: string;
  autoHttps: boolean;
  isPreview: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface GitRepositoryDTO {
  id: string;
  provider: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  webhookActive: boolean;
  createdAt: string;
}

export interface AuditLogDTO {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface CommandDTO {
  id: string;
  nodeId: string;
  type: CommandType;
  status: CommandStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ApiTokenDTO {
  id: string;
  name: string;
  lastFour: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PlanDTO {
  key: string;
  name: string;
  maxNodes: number;
  maxApps: number;
  maxDeploymentsPerDay: number;
  logRetentionDays: number;
}

export interface WorkspaceStatsDTO {
  apps: number;
  nodes: number;
  onlineNodes: number;
  deployments: number;
  runningApps: number;
  deploymentsToday: number;
}
