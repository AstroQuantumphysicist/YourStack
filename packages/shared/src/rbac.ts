import { ROLE_RANK, WorkspaceRole } from './enums.js';

/**
 * Permission catalog. Permissions are the atomic unit checked by API guards.
 * Roles map to sets of permissions. Keep this list the single source of truth
 * for both the API RBAC middleware and the web UI's capability gating.
 */
export const Permission = {
  // Workspace
  WORKSPACE_VIEW: 'workspace:view',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_BILLING: 'workspace:billing',
  // Members
  MEMBER_VIEW: 'member:view',
  MEMBER_INVITE: 'member:invite',
  MEMBER_UPDATE_ROLE: 'member:update_role',
  MEMBER_REMOVE: 'member:remove',
  // Projects
  PROJECT_VIEW: 'project:view',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  // Apps
  APP_VIEW: 'app:view',
  APP_CREATE: 'app:create',
  APP_UPDATE: 'app:update',
  APP_DELETE: 'app:delete',
  APP_DEPLOY: 'app:deploy',
  APP_ROLLBACK: 'app:rollback',
  APP_CONTROL: 'app:control', // stop / restart
  // Nodes
  NODE_VIEW: 'node:view',
  NODE_JOIN: 'node:join', // create join token / register
  NODE_UPDATE: 'node:update',
  NODE_DRAIN: 'node:drain',
  NODE_REMOVE: 'node:remove',
  // Secrets
  SECRET_VIEW: 'secret:view', // view keys/metadata, never values
  SECRET_WRITE: 'secret:write',
  SECRET_DELETE: 'secret:delete',
  // Domains
  DOMAIN_VIEW: 'domain:view',
  DOMAIN_WRITE: 'domain:write',
  DOMAIN_DELETE: 'domain:delete',
  // Logs
  LOG_VIEW: 'log:view',
  // CI/CD
  REPO_CONNECT: 'repo:connect',
  REPO_VIEW: 'repo:view',
  PIPELINE_VIEW: 'pipeline:view',
  PIPELINE_TRIGGER: 'pipeline:trigger',
  // API tokens
  TOKEN_VIEW: 'token:view',
  TOKEN_CREATE: 'token:create',
  TOKEN_REVOKE: 'token:revoke',
  // Audit
  AUDIT_VIEW: 'audit:view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission);

const VIEWER_PERMISSIONS: Permission[] = [
  Permission.WORKSPACE_VIEW,
  Permission.MEMBER_VIEW,
  Permission.PROJECT_VIEW,
  Permission.APP_VIEW,
  Permission.NODE_VIEW,
  Permission.SECRET_VIEW,
  Permission.DOMAIN_VIEW,
  Permission.LOG_VIEW,
  Permission.REPO_VIEW,
  Permission.PIPELINE_VIEW,
];

const DEVELOPER_PERMISSIONS: Permission[] = [
  ...VIEWER_PERMISSIONS,
  Permission.PROJECT_CREATE,
  Permission.PROJECT_UPDATE,
  Permission.APP_CREATE,
  Permission.APP_UPDATE,
  Permission.APP_DEPLOY,
  Permission.APP_ROLLBACK,
  Permission.APP_CONTROL,
  Permission.NODE_JOIN,
  Permission.NODE_UPDATE,
  Permission.NODE_DRAIN,
  Permission.SECRET_WRITE,
  Permission.SECRET_DELETE,
  Permission.DOMAIN_WRITE,
  Permission.DOMAIN_DELETE,
  Permission.REPO_CONNECT,
  Permission.PIPELINE_TRIGGER,
  Permission.TOKEN_VIEW,
  Permission.TOKEN_CREATE,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...DEVELOPER_PERMISSIONS,
  Permission.WORKSPACE_UPDATE,
  Permission.MEMBER_INVITE,
  Permission.MEMBER_UPDATE_ROLE,
  Permission.MEMBER_REMOVE,
  Permission.PROJECT_DELETE,
  Permission.APP_DELETE,
  Permission.NODE_REMOVE,
  Permission.TOKEN_REVOKE,
  Permission.AUDIT_VIEW,
];

/** Owner has everything, including destructive/billing actions. */
const OWNER_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  [WorkspaceRole.OWNER]: new Set(OWNER_PERMISSIONS),
  [WorkspaceRole.ADMIN]: new Set(ADMIN_PERMISSIONS),
  [WorkspaceRole.DEVELOPER]: new Set(DEVELOPER_PERMISSIONS),
  [WorkspaceRole.VIEWER]: new Set(VIEWER_PERMISSIONS),
};

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsForRole(role: WorkspaceRole): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

/** True when `role` is at least as privileged as `min`. */
export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
