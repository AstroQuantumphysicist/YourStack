/**
 * Audit helper — a thin, storage-agnostic contract. The API provides a `sink`
 * that persists to the AuditLog table; this keeps the audit surface consistent
 * and typed across call sites.
 */
export interface AuditEntry {
  workspaceId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export type AuditSink = (entry: AuditEntry) => Promise<void>;

/** Canonical action names for sensitive events (used across API + worker). */
export const AuditAction = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  WORKSPACE_CREATE: 'workspace.create',
  WORKSPACE_UPDATE: 'workspace.update',
  WORKSPACE_SUSPEND: 'workspace.suspend',
  MEMBER_INVITE: 'member.invite',
  MEMBER_ROLE_UPDATE: 'member.role_update',
  MEMBER_REMOVE: 'member.remove',
  NODE_JOIN_TOKEN_CREATE: 'node.join_token_create',
  NODE_REGISTER: 'node.register',
  NODE_DRAIN: 'node.drain',
  NODE_REMOVE: 'node.remove',
  APP_CREATE: 'app.create',
  APP_DEPLOY: 'app.deploy',
  APP_ROLLBACK: 'app.rollback',
  APP_STOP: 'app.stop',
  APP_RESTART: 'app.restart',
  APP_DELETE: 'app.delete',
  SECRET_CREATE: 'secret.create',
  SECRET_UPDATE: 'secret.update',
  SECRET_DELETE: 'secret.delete',
  DOMAIN_CREATE: 'domain.create',
  DOMAIN_DELETE: 'domain.delete',
  REPO_CONNECT: 'repo.connect',
  TOKEN_CREATE: 'token.create',
  TOKEN_REVOKE: 'token.revoke',
  ADMIN_WORKSPACE_SUSPEND: 'admin.workspace_suspend',
  ADMIN_NODE_DISABLE: 'admin.node_disable',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
