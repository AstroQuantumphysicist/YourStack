import type { FastifyRequest } from 'fastify';
import { ROLE_RANK, type Permission, roleHasPermission, type WorkspaceRole } from '@yourstack/shared';
import type { PrismaClient } from '@yourstack/db';
import { Errors } from './errors.js';
import { requireUser } from './auth.js';

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
}

/** Pick the most privileged of two workspace roles. */
function maxRole(a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * Resolve the caller's EFFECTIVE role in a workspace, throwing 403/404 as needed.
 * A user's access is the maximum of:
 *   1. platform admin           → owner (any workspace)
 *   2. org owner/admin          → owner/admin of every workspace in the org
 *   3. direct workspace member  → their WorkspaceMember role
 *   4. team grant               → the role granted to any team they belong to
 */
export async function resolveMembership(
  prisma: PrismaClient,
  req: FastifyRequest,
  workspaceId: string,
): Promise<WorkspaceMembership> {
  const user = requireUser(req);
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { id: true, status: true, organizationId: true },
  });
  if (!workspace) throw Errors.notFound('Workspace not found');

  if (user.isPlatformAdmin) {
    return { workspaceId, role: 'owner' };
  }

  let effective: WorkspaceRole | null = null;

  // 2. Organization-level role.
  if (workspace.organizationId) {
    const orgMember = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: workspace.organizationId, userId: user.id } },
      select: { role: true },
    });
    if (orgMember?.role === 'owner') effective = maxRole(effective, 'owner');
    else if (orgMember?.role === 'admin') effective = maxRole(effective, 'admin');
  }

  // 3. Direct workspace membership.
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (member) effective = maxRole(effective, member.role as WorkspaceRole);

  // 4. Team grants (any team the user belongs to that is granted this workspace).
  const grants = await prisma.workspaceGrant.findMany({
    where: { workspaceId, team: { members: { some: { userId: user.id } } } },
    select: { role: true },
  });
  for (const g of grants) effective = maxRole(effective, g.role as WorkspaceRole);

  if (!effective) throw Errors.forbidden('You do not have access to this workspace');
  if (workspace.status === 'suspended') {
    throw Errors.forbidden('This workspace is suspended');
  }
  return { workspaceId, role: effective };
}

/** Resolve the caller's org role, throwing 403/404. Platform admins are owners. */
export async function resolveOrgRole(
  prisma: PrismaClient,
  req: FastifyRequest,
  organizationId: string,
): Promise<'owner' | 'admin' | 'member'> {
  const user = requireUser(req);
  if (user.isPlatformAdmin) return 'owner';
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!org) throw Errors.notFound('Organization not found');
  const member = await prisma.orgMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    select: { role: true },
  });
  if (!member) throw Errors.forbidden('You are not a member of this organization');
  return member.role as 'owner' | 'admin' | 'member';
}

/** Require at least the given org role (owner > admin > member). */
export async function requireOrgRole(
  prisma: PrismaClient,
  req: FastifyRequest,
  organizationId: string,
  min: 'owner' | 'admin' | 'member',
): Promise<'owner' | 'admin' | 'member'> {
  const role = await resolveOrgRole(prisma, req, organizationId);
  const rank = { owner: 2, admin: 1, member: 0 };
  if (rank[role] < rank[min]) throw Errors.forbidden(`Requires organization ${min} role`);
  return role;
}

/** Assert the membership grants the given permission. */
export function assertPermission(membership: WorkspaceMembership, permission: Permission): void {
  if (!roleHasPermission(membership.role, permission)) {
    throw Errors.forbidden(`Missing permission: ${permission}`);
  }
}

/** Convenience: resolve membership for a workspace and require a permission. */
export async function requirePermission(
  prisma: PrismaClient,
  req: FastifyRequest,
  workspaceId: string,
  permission: Permission,
): Promise<WorkspaceMembership> {
  const membership = await resolveMembership(prisma, req, workspaceId);
  assertPermission(membership, permission);
  return membership;
}

export function requirePlatformAdmin(req: FastifyRequest): void {
  const user = requireUser(req);
  if (!user.isPlatformAdmin) throw Errors.forbidden('Platform admin required');
}
