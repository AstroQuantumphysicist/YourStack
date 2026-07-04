import type { FastifyRequest } from 'fastify';
import { type Permission, roleHasPermission, type WorkspaceRole } from '@noderail/shared';
import type { PrismaClient } from '@noderail/db';
import { Errors } from './errors.js';
import { requireUser } from './auth.js';

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
}

/**
 * Resolve the caller's membership in a workspace, throwing 403/404 as needed.
 * Platform admins are granted owner-level access to any workspace.
 */
export async function resolveMembership(
  prisma: PrismaClient,
  req: FastifyRequest,
  workspaceId: string,
): Promise<WorkspaceMembership> {
  const user = requireUser(req);
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!workspace) throw Errors.notFound('Workspace not found');

  if (user.isPlatformAdmin) {
    return { workspaceId, role: 'owner' };
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (!member) throw Errors.forbidden('You are not a member of this workspace');
  if (workspace.status === 'suspended') {
    throw Errors.forbidden('This workspace is suspended');
  }
  return { workspaceId, role: member.role as WorkspaceRole };
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
