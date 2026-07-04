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
} from '@noderail/db';
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
} from '@noderail/shared';
import { iso } from './util.js';

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
