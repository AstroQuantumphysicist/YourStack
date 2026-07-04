-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('lead', 'member');

-- CreateEnum
CREATE TYPE "FirewallStatus" AS ENUM ('draft', 'applying', 'active', 'failed');

-- CreateEnum
CREATE TYPE "LoadBalancerStatus" AS ENUM ('provisioning', 'active', 'degraded', 'failed');

-- CreateEnum
CREATE TYPE "LBAlgorithm" AS ENUM ('round_robin', 'least_conn', 'ip_hash');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommandType" ADD VALUE 'CONFIGURE_FIREWALL';
ALTER TYPE "CommandType" ADD VALUE 'PROVISION_LB';
ALTER TYPE "CommandType" ADD VALUE 'REMOVE_LB';
ALTER TYPE "CommandType" ADD VALUE 'NODE_REBOOT';
ALTER TYPE "CommandType" ADD VALUE 'DOCKER_PRUNE';
ALTER TYPE "CommandType" ADD VALUE 'AGENT_UPDATE';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceGrant" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'developer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Firewall" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FirewallStatus" NOT NULL DEFAULT 'draft',
    "defaultInbound" TEXT NOT NULL DEFAULT 'deny',
    "defaultOutbound" TEXT NOT NULL DEFAULT 'allow',
    "nodeIds" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Firewall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallRule" (
    "id" TEXT NOT NULL,
    "firewallId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "action" TEXT NOT NULL DEFAULT 'allow',
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "port" TEXT,
    "cidr" TEXT NOT NULL DEFAULT '0.0.0.0/0',
    "comment" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadBalancer" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT,
    "name" TEXT NOT NULL,
    "status" "LoadBalancerStatus" NOT NULL DEFAULT 'provisioning',
    "listenPort" INTEGER NOT NULL DEFAULT 80,
    "algorithm" "LBAlgorithm" NOT NULL DEFAULT 'round_robin',
    "region" TEXT,
    "domain" TEXT,
    "autoHttps" BOOLEAN NOT NULL DEFAULT false,
    "sticky" BOOLEAN NOT NULL DEFAULT false,
    "containerName" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LoadBalancer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LBTarget" (
    "id" TEXT NOT NULL,
    "loadBalancerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "appId" TEXT,

    CONSTRAINT "LBTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrgMember_userId_idx" ON "OrgMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_organizationId_userId_key" ON "OrgMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_slug_key" ON "Team"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceGrant_workspaceId_idx" ON "WorkspaceGrant"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceGrant_teamId_workspaceId_key" ON "WorkspaceGrant"("teamId", "workspaceId");

-- CreateIndex
CREATE INDEX "Firewall_workspaceId_idx" ON "Firewall"("workspaceId");

-- CreateIndex
CREATE INDEX "FirewallRule_firewallId_position_idx" ON "FirewallRule"("firewallId", "position");

-- CreateIndex
CREATE INDEX "LoadBalancer_projectId_idx" ON "LoadBalancer"("projectId");

-- CreateIndex
CREATE INDEX "LoadBalancer_nodeId_idx" ON "LoadBalancer"("nodeId");

-- CreateIndex
CREATE INDEX "LBTarget_loadBalancerId_idx" ON "LBTarget"("loadBalancerId");

-- CreateIndex
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGrant" ADD CONSTRAINT "WorkspaceGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGrant" ADD CONSTRAINT "WorkspaceGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Firewall" ADD CONSTRAINT "Firewall_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirewallRule" ADD CONSTRAINT "FirewallRule_firewallId_fkey" FOREIGN KEY ("firewallId") REFERENCES "Firewall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadBalancer" ADD CONSTRAINT "LoadBalancer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadBalancer" ADD CONSTRAINT "LoadBalancer_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LBTarget" ADD CONSTRAINT "LBTarget_loadBalancerId_fkey" FOREIGN KEY ("loadBalancerId") REFERENCES "LoadBalancer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
