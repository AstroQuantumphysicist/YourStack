import type {
  App,
  Deployment,
  Domain,
  GitRepository,
  Node,
  NodeLabel,
  Project,
  Secret,
  Workspace,
  WorkspaceMember,
  User,
  AuditLog,
  ApiToken,
  PipelineRun,
  PipelineStage,
  Plan,
  ManagedDatabase,
  StorageBucket,
  ServerlessFunction,
  RunnerPool,
  Runner,
  ScalingPolicy,
  Region,
  Template,
  CronJob,
  GithubInstallation,
} from '@yourstack/db';
import type {
  AppDTO,
  DeploymentDTO,
  DomainDTO,
  GitRepositoryDTO,
  MemberDTO,
  NodeDTO,
  ProjectDTO,
  SecretDTO,
  UserDTO,
  WorkspaceDTO,
  AuditLogDTO,
  ApiTokenDTO,
  PipelineRunDTO,
  PlanDTO,
  WorkspaceRole,
  AppFramework,
  DeploymentStrategy,
  SecretScope,
  DatabaseDTO,
  BucketDTO,
  FunctionDTO,
  RunnerPoolDTO,
  RunnerDTO,
  ScalingPolicyDTO,
  RegionDTO,
  TemplateDTO,
  TemplateVariableDTO,
  CronJobDTO,
  GithubInstallationDTO,
} from '@yourstack/shared';
import { iso } from './util.js';
import { templateVariableDTOs } from '../services/template.service.js';

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    isPlatformAdmin: u.isPlatformAdmin,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toWorkspaceDTO(w: Workspace, role: WorkspaceRole): WorkspaceDTO {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    status: w.status,
    role,
    planKey: w.planKey,
    createdAt: w.createdAt.toISOString(),
  };
}

export function toMemberDTO(m: WorkspaceMember & { user: User }): MemberDTO {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl,
    role: m.role as WorkspaceRole,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toProjectDTO(p: Project & { _count?: { apps: number } }): ProjectDTO {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    slug: p.slug,
    description: p.description,
    appCount: p._count?.apps ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toAppDTO(a: App): AppDTO {
  return {
    id: a.id,
    projectId: a.projectId,
    name: a.name,
    slug: a.slug,
    status: a.status,
    framework: (a.framework as AppFramework | null) ?? null,
    repoUrl: a.repoUrl,
    branch: a.branch,
    port: a.port,
    buildCommand: a.buildCommand,
    startCommand: a.startCommand,
    installCommand: a.installCommand,
    deploymentStrategy: a.deploymentStrategy as DeploymentStrategy,
    nodeId: a.nodeId,
    healthcheckPath: a.healthcheckPath,
    currentDeploymentId: a.currentDeploymentId,
    cpu: a.cpu,
    memoryMb: a.memoryMb,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toNodeDTO(
  n: Node & { labels?: NodeLabel[]; _count?: { apps: number } },
): NodeDTO {
  return {
    id: n.id,
    workspaceId: n.workspaceId,
    name: n.name,
    status: n.status,
    region: n.region,
    os: n.os,
    arch: n.arch,
    agentVersion: n.agentVersion,
    dockerVersion: n.dockerVersion,
    publicIp: n.publicIp,
    cpuCores: n.cpuCores,
    cpuUsagePercent: n.cpuUsagePercent,
    memoryTotalMb: n.memoryTotalMb,
    memoryUsedMb: n.memoryUsedMb,
    diskTotalMb: n.diskTotalMb,
    diskUsedMb: n.diskUsedMb,
    lastHeartbeatAt: iso(n.lastHeartbeatAt),
    labels: (n.labels ?? []).map((l) => ({ key: l.key, value: l.value })),
    runningAppCount: n._count?.apps ?? 0,
    createdAt: n.createdAt.toISOString(),
  };
}

export function toDeploymentDTO(d: Deployment): DeploymentDTO {
  return {
    id: d.id,
    appId: d.appId,
    version: d.version,
    status: d.status,
    nodeId: d.nodeId,
    imageTag: d.imageTag,
    ref: d.ref,
    commitSha: d.commitSha,
    commitMessage: d.commitMessage,
    reason: d.reason,
    healthy: d.healthy,
    hostPort: d.hostPort,
    triggeredBy: d.triggeredBy,
    startedAt: iso(d.startedAt),
    finishedAt: iso(d.finishedAt),
    createdAt: d.createdAt.toISOString(),
  };
}

export function toPipelineRunDTO(r: PipelineRun & { stages: PipelineStage[] }): PipelineRunDTO {
  return {
    id: r.id,
    appId: r.appId,
    deploymentId: r.deploymentId,
    status: r.status,
    trigger: r.trigger,
    ref: r.ref,
    commitSha: r.commitSha,
    stages: r.stages
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        name: s.name,
        status: s.status,
        startedAt: iso(s.startedAt),
        finishedAt: iso(s.finishedAt),
        exitCode: s.exitCode,
      })),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toSecretDTO(s: Secret): SecretDTO {
  return {
    id: s.id,
    scope: s.scope as SecretScope,
    key: s.key,
    lastFour: s.lastFour,
    projectId: s.projectId,
    appId: s.appId,
    environmentId: s.environmentId,
    updatedAt: s.updatedAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
  };
}

export function toDomainDTO(d: Domain): DomainDTO {
  return {
    id: d.id,
    appId: d.appId,
    hostname: d.hostname,
    status: d.status,
    verificationToken: d.verificationToken,
    dnsTarget: d.dnsTarget,
    autoHttps: d.autoHttps,
    isPreview: d.isPreview,
    lastCheckedAt: iso(d.lastCheckedAt),
    createdAt: d.createdAt.toISOString(),
  };
}

export function toRepoDTO(r: GitRepository): GitRepositoryDTO {
  return {
    id: r.id,
    provider: r.provider,
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    defaultBranch: r.defaultBranch,
    private: r.private,
    webhookActive: r.webhookActive,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toAuditDTO(a: AuditLog): AuditLogDTO {
  return {
    id: a.id,
    actorId: a.actorId,
    actorEmail: a.actorEmail,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    ip: a.ip,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toApiTokenDTO(t: ApiToken): ApiTokenDTO {
  return {
    id: t.id,
    name: t.name,
    lastFour: t.lastFour,
    lastUsedAt: iso(t.lastUsedAt),
    expiresAt: iso(t.expiresAt),
    createdAt: t.createdAt.toISOString(),
  };
}

export function toPlanDTO(p: Plan): PlanDTO {
  return {
    key: p.key,
    name: p.name,
    maxNodes: p.maxNodes,
    maxApps: p.maxApps,
    maxDeploymentsPerDay: p.maxDeploymentsPerDay,
    logRetentionDays: p.logRetentionDays,
  };
}

/* --------------------------- Managed resources (v2) ------------------------- */

export function toDatabaseDTO(d: ManagedDatabase): DatabaseDTO {
  return {
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    engine: d.engine,
    version: d.version,
    status: d.status,
    nodeId: d.nodeId,
    region: d.region,
    host: d.host,
    port: d.port,
    storageMb: d.storageMb,
    cpu: d.cpu,
    memoryMb: d.memoryMb,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toBucketDTO(b: StorageBucket): BucketDTO {
  return {
    id: b.id,
    projectId: b.projectId,
    name: b.name,
    status: b.status,
    nodeId: b.nodeId,
    region: b.region,
    endpoint: b.endpoint,
    isPublic: b.isPublic,
    quotaMb: b.quotaMb,
    usedMb: b.usedMb,
    objectCount: b.objectCount,
    createdAt: b.createdAt.toISOString(),
  };
}

export function toFunctionDTO(
  f: ServerlessFunction & { _count?: { invocations: number } },
): FunctionDTO {
  return {
    id: f.id,
    projectId: f.projectId,
    name: f.name,
    runtime: f.runtime,
    status: f.status,
    handler: f.handler,
    nodeId: f.nodeId,
    region: f.region,
    url: f.url,
    memoryMb: f.memoryMb,
    timeoutMs: f.timeoutMs,
    minInstances: f.minInstances,
    invocations24h: f._count?.invocations ?? 0,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toRunnerPoolDTO(
  p: RunnerPool & { runners?: Runner[] },
): RunnerPoolDTO {
  const runners = p.runners ?? [];
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    githubScope: p.githubScope,
    labels: p.labels,
    minRunners: p.minRunners,
    maxRunners: p.maxRunners,
    activeRunners: runners.filter((r) => r.status !== 'offline').length,
    busyRunners: runners.filter((r) => r.status === 'busy').length,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toRunnerDTO(r: Runner): RunnerDTO {
  return {
    id: r.id,
    poolId: r.poolId,
    nodeId: r.nodeId,
    status: r.status,
    currentJob: r.currentJob,
    lastSeenAt: iso(r.lastSeenAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toScalingPolicyDTO(s: ScalingPolicy): ScalingPolicyDTO {
  return {
    id: s.id,
    appId: s.appId,
    enabled: s.enabled,
    minReplicas: s.minReplicas,
    maxReplicas: s.maxReplicas,
    metric: s.metric,
    targetValue: s.targetValue,
    currentReplicas: s.currentReplicas,
    cooldownSeconds: s.cooldownSeconds,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toRegionDTO(r: Region, nodeCount: number): RegionDTO {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    country: r.country,
    flag: r.flag,
    nodeCount,
    latencyMs: null,
  };
}

/* ------------------------------ Marketplace (v3) ---------------------------- */

export function toTemplateDTO(t: Template): TemplateDTO {
  const variables: TemplateVariableDTO[] = templateVariableDTOs(t.spec);
  return {
    slug: t.slug,
    name: t.name,
    category: t.category,
    kind: t.kind,
    description: t.description,
    icon: t.icon,
    image: t.image,
    tags: t.tags,
    popularity: t.popularity,
    variables,
  };
}

export function toCronJobDTO(c: CronJob): CronJobDTO {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    schedule: c.schedule,
    image: c.image,
    command: c.command,
    status: c.status,
    nodeId: c.nodeId,
    region: c.region,
    lastRunAt: iso(c.lastRunAt),
    lastRunStatus: c.lastRunStatus,
    nextRunAt: iso(c.nextRunAt),
    createdAt: c.createdAt.toISOString(),
  };
}

export function toGithubInstallationDTO(i: GithubInstallation): GithubInstallationDTO {
  return {
    id: i.id,
    installationId: i.installationId,
    accountLogin: i.accountLogin,
    accountType: i.accountType,
    repositorySelection: i.repositorySelection,
    // Count of explicitly-selected repos; "all" installations signal via repositorySelection.
    repositoryCount: i.repositories.length,
    createdAt: i.createdAt.toISOString(),
  };
}
