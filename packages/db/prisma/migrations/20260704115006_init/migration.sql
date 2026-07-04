-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'developer', 'viewer');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('idle', 'building', 'deploying', 'running', 'failed', 'stopped');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('online', 'degraded', 'offline', 'draining');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('queued', 'building', 'deploying', 'running', 'failed', 'stopped', 'rolled_back', 'superseded');

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('DEPLOY_APP', 'STOP_APP', 'RESTART_APP', 'REMOVE_APP', 'STREAM_LOGS', 'HEALTH_CHECK', 'CONFIGURE_DOMAIN', 'ROLLBACK_DEPLOYMENT');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('queued', 'accepted', 'running', 'succeeded', 'failed', 'timed_out');

-- CreateEnum
CREATE TYPE "AppFramework" AS ENUM ('nextjs', 'node', 'python', 'dockerfile', 'static');

-- CreateEnum
CREATE TYPE "DeploymentStrategy" AS ENUM ('basic_replace', 'rolling');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('pending', 'verifying', 'verified', 'active', 'failed');

-- CreateEnum
CREATE TYPE "SecretScope" AS ENUM ('project', 'app', 'environment');

-- CreateEnum
CREATE TYPE "EnvironmentType" AS ENUM ('production', 'preview', 'development');

-- CreateEnum
CREATE TYPE "LogStream" AS ENUM ('build', 'runtime', 'system');

-- CreateEnum
CREATE TYPE "LogSeverity" AS ENUM ('debug', 'info', 'warn', 'error');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "scope" TEXT,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxNodes" INTEGER NOT NULL,
    "maxApps" INTEGER NOT NULL,
    "maxDeploymentsPerDay" INTEGER NOT NULL,
    "logRetentionDays" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'active',
    "planKey" TEXT NOT NULL DEFAULT 'dev',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'developer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "AppStatus" NOT NULL DEFAULT 'idle',
    "framework" "AppFramework",
    "repoUrl" TEXT,
    "gitRepositoryId" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "installCommand" TEXT,
    "buildCommand" TEXT,
    "startCommand" TEXT,
    "port" INTEGER NOT NULL DEFAULT 3000,
    "cpu" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "memoryMb" INTEGER NOT NULL DEFAULT 512,
    "deploymentStrategy" "DeploymentStrategy" NOT NULL DEFAULT 'basic_replace',
    "healthcheckPath" TEXT NOT NULL DEFAULT '/',
    "nodeId" TEXT,
    "currentDeploymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppEnvironment" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EnvironmentType" NOT NULL DEFAULT 'production',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Secret" (
    "id" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "lastFour" TEXT,
    "projectId" TEXT,
    "appId" TEXT,
    "environmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'offline',
    "region" TEXT,
    "os" TEXT,
    "arch" TEXT,
    "kernel" TEXT,
    "agentVersion" TEXT,
    "dockerVersion" TEXT,
    "publicIp" TEXT,
    "commandKey" TEXT NOT NULL,
    "agentTokenHash" TEXT,
    "cpuCores" INTEGER,
    "cpuUsagePercent" DOUBLE PRECISION,
    "memoryTotalMb" INTEGER,
    "memoryUsedMb" INTEGER,
    "diskTotalMb" INTEGER,
    "diskUsedMb" INTEGER,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeLabel" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "NodeLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeJoinToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "region" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByNode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeJoinToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeHeartbeat" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "cpuUsagePercent" DOUBLE PRECISION NOT NULL,
    "memoryUsedMb" INTEGER NOT NULL,
    "diskUsedMb" INTEGER NOT NULL,
    "runningApps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeCommand" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "type" "CommandType" NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 300000,
    "deploymentId" TEXT,
    "appId" TEXT,
    "output" JSONB,
    "error" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
    "nodeId" TEXT,
    "imageTag" TEXT,
    "imageDigest" TEXT,
    "containerId" TEXT,
    "containerName" TEXT,
    "ref" TEXT,
    "commitSha" TEXT,
    "commitMessage" TEXT,
    "reason" TEXT,
    "strategy" "DeploymentStrategy" NOT NULL DEFAULT 'basic_replace',
    "healthy" BOOLEAN,
    "hostPort" INTEGER,
    "specSnapshot" JSONB,
    "triggeredById" TEXT,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentLog" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "stream" "LogStream" NOT NULL DEFAULT 'build',
    "severity" "LogSeverity" NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeLog" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "nodeId" TEXT,
    "severity" "LogSeverity" NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "deploymentId" TEXT,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL,
    "ref" TEXT,
    "commitSha" TEXT,
    "commitMessage" TEXT,
    "prNumber" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'pending',
    "order" INTEGER NOT NULL,
    "exitCode" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitRepository" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "externalId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "private" BOOLEAN NOT NULL DEFAULT true,
    "installToken" TEXT,
    "webhookId" TEXT,
    "webhookActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitWebhook" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "action" TEXT,
    "ref" TEXT,
    "commitSha" TEXT,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'pending',
    "verificationToken" TEXT NOT NULL,
    "dnsTarget" TEXT NOT NULL,
    "autoHttps" BOOLEAN NOT NULL DEFAULT true,
    "isPreview" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_key" ON "OAuthAccount"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_slug_idx" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_day_idx" ON "UsageRecord"("workspaceId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_workspaceId_metric_day_key" ON "UsageRecord"("workspaceId", "metric", "day");

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_slug_key" ON "Project"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "App_currentDeploymentId_key" ON "App"("currentDeploymentId");

-- CreateIndex
CREATE INDEX "App_projectId_idx" ON "App"("projectId");

-- CreateIndex
CREATE INDEX "App_nodeId_idx" ON "App"("nodeId");

-- CreateIndex
CREATE INDEX "App_status_idx" ON "App"("status");

-- CreateIndex
CREATE UNIQUE INDEX "App_projectId_slug_key" ON "App"("projectId", "slug");

-- CreateIndex
CREATE INDEX "AppEnvironment_appId_idx" ON "AppEnvironment"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "AppEnvironment_appId_name_key" ON "AppEnvironment"("appId", "name");

-- CreateIndex
CREATE INDEX "Secret_projectId_idx" ON "Secret"("projectId");

-- CreateIndex
CREATE INDEX "Secret_appId_idx" ON "Secret"("appId");

-- CreateIndex
CREATE INDEX "Secret_environmentId_idx" ON "Secret"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Secret_scope_projectId_appId_environmentId_key_key" ON "Secret"("scope", "projectId", "appId", "environmentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Node_agentTokenHash_key" ON "Node"("agentTokenHash");

-- CreateIndex
CREATE INDEX "Node_workspaceId_idx" ON "Node"("workspaceId");

-- CreateIndex
CREATE INDEX "Node_status_idx" ON "Node"("status");

-- CreateIndex
CREATE INDEX "Node_lastHeartbeatAt_idx" ON "Node"("lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "NodeLabel_nodeId_idx" ON "NodeLabel"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeLabel_nodeId_key_key" ON "NodeLabel"("nodeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NodeJoinToken_tokenHash_key" ON "NodeJoinToken"("tokenHash");

-- CreateIndex
CREATE INDEX "NodeJoinToken_workspaceId_idx" ON "NodeJoinToken"("workspaceId");

-- CreateIndex
CREATE INDEX "NodeJoinToken_expiresAt_idx" ON "NodeJoinToken"("expiresAt");

-- CreateIndex
CREATE INDEX "NodeHeartbeat_nodeId_createdAt_idx" ON "NodeHeartbeat"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "NodeCommand_nodeId_status_idx" ON "NodeCommand"("nodeId", "status");

-- CreateIndex
CREATE INDEX "NodeCommand_deploymentId_idx" ON "NodeCommand"("deploymentId");

-- CreateIndex
CREATE INDEX "NodeCommand_status_issuedAt_idx" ON "NodeCommand"("status", "issuedAt");

-- CreateIndex
CREATE INDEX "Deployment_appId_createdAt_idx" ON "Deployment"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE INDEX "Deployment_nodeId_idx" ON "Deployment"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_appId_version_key" ON "Deployment"("appId", "version");

-- CreateIndex
CREATE INDEX "DeploymentLog_deploymentId_seq_idx" ON "DeploymentLog"("deploymentId", "seq");

-- CreateIndex
CREATE INDEX "DeploymentLog_deploymentId_createdAt_idx" ON "DeploymentLog"("deploymentId", "createdAt");

-- CreateIndex
CREATE INDEX "RuntimeLog_appId_createdAt_idx" ON "RuntimeLog"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "RuntimeLog_severity_idx" ON "RuntimeLog"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRun_deploymentId_key" ON "PipelineRun"("deploymentId");

-- CreateIndex
CREATE INDEX "PipelineRun_appId_createdAt_idx" ON "PipelineRun"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineRun_status_idx" ON "PipelineRun"("status");

-- CreateIndex
CREATE INDEX "PipelineStage_runId_order_idx" ON "PipelineStage"("runId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_runId_name_key" ON "PipelineStage"("runId", "name");

-- CreateIndex
CREATE INDEX "GitRepository_workspaceId_idx" ON "GitRepository"("workspaceId");

-- CreateIndex
CREATE INDEX "GitRepository_fullName_idx" ON "GitRepository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "GitRepository_workspaceId_provider_externalId_key" ON "GitRepository"("workspaceId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "GitWebhook_deliveryId_key" ON "GitWebhook"("deliveryId");

-- CreateIndex
CREATE INDEX "GitWebhook_repositoryId_createdAt_idx" ON "GitWebhook"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "GitWebhook_processed_idx" ON "GitWebhook"("processed");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");

-- CreateIndex
CREATE INDEX "Domain_appId_idx" ON "Domain"("appId");

-- CreateIndex
CREATE INDEX "Domain_status_idx" ON "Domain"("status");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "ApiToken_workspaceId_idx" ON "ApiToken"("workspaceId");

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "Plan"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_gitRepositoryId_fkey" FOREIGN KEY ("gitRepositoryId") REFERENCES "GitRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_currentDeploymentId_fkey" FOREIGN KEY ("currentDeploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppEnvironment" ADD CONSTRAINT "AppEnvironment_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Secret" ADD CONSTRAINT "Secret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Secret" ADD CONSTRAINT "Secret_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Secret" ADD CONSTRAINT "Secret_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "AppEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeLabel" ADD CONSTRAINT "NodeLabel_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeJoinToken" ADD CONSTRAINT "NodeJoinToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeHeartbeat" ADD CONSTRAINT "NodeHeartbeat_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeCommand" ADD CONSTRAINT "NodeCommand_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeCommand" ADD CONSTRAINT "NodeCommand_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentLog" ADD CONSTRAINT "DeploymentLog_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeLog" ADD CONSTRAINT "RuntimeLog_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitRepository" ADD CONSTRAINT "GitRepository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitWebhook" ADD CONSTRAINT "GitWebhook_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
