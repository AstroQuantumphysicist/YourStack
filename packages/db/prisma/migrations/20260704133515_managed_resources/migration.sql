-- CreateEnum
CREATE TYPE "DatabaseEngine" AS ENUM ('postgres', 'mysql', 'redis', 'mongodb');

-- CreateEnum
CREATE TYPE "DatabaseStatus" AS ENUM ('provisioning', 'running', 'stopped', 'backing_up', 'failed');

-- CreateEnum
CREATE TYPE "BucketStatus" AS ENUM ('provisioning', 'active', 'failed');

-- CreateEnum
CREATE TYPE "FunctionRuntime" AS ENUM ('node20', 'python311', 'go122', 'bun1');

-- CreateEnum
CREATE TYPE "FunctionStatus" AS ENUM ('idle', 'deploying', 'active', 'failed');

-- CreateEnum
CREATE TYPE "RunnerStatus" AS ENUM ('registering', 'idle', 'busy', 'offline');

-- CreateEnum
CREATE TYPE "ScalingMetric" AS ENUM ('cpu', 'memory', 'rps', 'latency');

-- CreateEnum
CREATE TYPE "MetricScope" AS ENUM ('app', 'node', 'database', 'function');

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "flag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedDatabase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT,
    "name" TEXT NOT NULL,
    "engine" "DatabaseEngine" NOT NULL,
    "version" TEXT NOT NULL DEFAULT '16',
    "status" "DatabaseStatus" NOT NULL DEFAULT 'provisioning',
    "region" TEXT,
    "host" TEXT,
    "port" INTEGER,
    "containerName" TEXT,
    "containerId" TEXT,
    "username" TEXT NOT NULL DEFAULT 'yourstack',
    "passwordCipher" TEXT,
    "connCipher" TEXT,
    "storageMb" INTEGER NOT NULL DEFAULT 10240,
    "cpu" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "memoryMb" INTEGER NOT NULL DEFAULT 1024,
    "lastBackupAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ManagedDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageBucket" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT,
    "name" TEXT NOT NULL,
    "status" "BucketStatus" NOT NULL DEFAULT 'provisioning',
    "region" TEXT,
    "endpoint" TEXT,
    "containerName" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "accessKey" TEXT,
    "secretCipher" TEXT,
    "quotaMb" INTEGER NOT NULL DEFAULT 51200,
    "usedMb" INTEGER NOT NULL DEFAULT 0,
    "objectCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StorageBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerlessFunction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT,
    "name" TEXT NOT NULL,
    "runtime" "FunctionRuntime" NOT NULL,
    "status" "FunctionStatus" NOT NULL DEFAULT 'idle',
    "handler" TEXT NOT NULL DEFAULT 'index.handler',
    "region" TEXT,
    "url" TEXT,
    "containerName" TEXT,
    "memoryMb" INTEGER NOT NULL DEFAULT 256,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "minInstances" INTEGER NOT NULL DEFAULT 0,
    "repoUrl" TEXT,
    "branch" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ServerlessFunction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunctionInvocation" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunctionInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunnerPool" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "githubScope" TEXT NOT NULL,
    "labels" TEXT[],
    "minRunners" INTEGER NOT NULL DEFAULT 0,
    "maxRunners" INTEGER NOT NULL DEFAULT 5,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RunnerPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runner" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "nodeId" TEXT,
    "status" "RunnerStatus" NOT NULL DEFAULT 'registering',
    "containerName" TEXT,
    "currentJob" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Runner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScalingPolicy" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minReplicas" INTEGER NOT NULL DEFAULT 1,
    "maxReplicas" INTEGER NOT NULL DEFAULT 3,
    "metric" "ScalingMetric" NOT NULL DEFAULT 'cpu',
    "targetValue" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "currentReplicas" INTEGER NOT NULL DEFAULT 1,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 120,
    "lastScaledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScalingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceMetric" (
    "id" TEXT NOT NULL,
    "scope" "MetricScope" NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "instance" TEXT,
    "nodeId" TEXT,
    "bucketTs" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_slug_key" ON "Region"("slug");

-- CreateIndex
CREATE INDEX "Region_slug_idx" ON "Region"("slug");

-- CreateIndex
CREATE INDEX "ManagedDatabase_projectId_idx" ON "ManagedDatabase"("projectId");

-- CreateIndex
CREATE INDEX "ManagedDatabase_nodeId_idx" ON "ManagedDatabase"("nodeId");

-- CreateIndex
CREATE INDEX "ManagedDatabase_status_idx" ON "ManagedDatabase"("status");

-- CreateIndex
CREATE INDEX "StorageBucket_nodeId_idx" ON "StorageBucket"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_projectId_name_key" ON "StorageBucket"("projectId", "name");

-- CreateIndex
CREATE INDEX "ServerlessFunction_nodeId_idx" ON "ServerlessFunction"("nodeId");

-- CreateIndex
CREATE INDEX "ServerlessFunction_status_idx" ON "ServerlessFunction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ServerlessFunction_projectId_name_key" ON "ServerlessFunction"("projectId", "name");

-- CreateIndex
CREATE INDEX "FunctionInvocation_functionId_createdAt_idx" ON "FunctionInvocation"("functionId", "createdAt");

-- CreateIndex
CREATE INDEX "RunnerPool_workspaceId_idx" ON "RunnerPool"("workspaceId");

-- CreateIndex
CREATE INDEX "Runner_poolId_status_idx" ON "Runner"("poolId", "status");

-- CreateIndex
CREATE INDEX "Runner_nodeId_idx" ON "Runner"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScalingPolicy_appId_key" ON "ScalingPolicy"("appId");

-- CreateIndex
CREATE INDEX "ResourceMetric_scope_targetId_kind_bucketTs_idx" ON "ResourceMetric"("scope", "targetId", "kind", "bucketTs");

-- CreateIndex
CREATE INDEX "ResourceMetric_bucketTs_idx" ON "ResourceMetric"("bucketTs");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceMetric_scope_targetId_kind_instance_bucketTs_key" ON "ResourceMetric"("scope", "targetId", "kind", "instance", "bucketTs");

-- AddForeignKey
ALTER TABLE "ManagedDatabase" ADD CONSTRAINT "ManagedDatabase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedDatabase" ADD CONSTRAINT "ManagedDatabase_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageBucket" ADD CONSTRAINT "StorageBucket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageBucket" ADD CONSTRAINT "StorageBucket_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerlessFunction" ADD CONSTRAINT "ServerlessFunction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerlessFunction" ADD CONSTRAINT "ServerlessFunction_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunctionInvocation" ADD CONSTRAINT "FunctionInvocation_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "ServerlessFunction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunnerPool" ADD CONSTRAINT "RunnerPool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runner" ADD CONSTRAINT "Runner_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RunnerPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runner" ADD CONSTRAINT "Runner_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScalingPolicy" ADD CONSTRAINT "ScalingPolicy_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
