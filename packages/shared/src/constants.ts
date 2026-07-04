/** Cross-cutting constants for the YourStack platform. */

export const API_VERSION = 'v1';
export const AGENT_PROTOCOL_VERSION = 1;

/** Heartbeat / liveness tuning. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A node with no heartbeat within this window is considered degraded. */
export const NODE_DEGRADED_AFTER_MS = 45_000;
/** A node with no heartbeat within this window is considered offline. */
export const NODE_OFFLINE_AFTER_MS = 90_000;
/**
 * Minimum spacing between auto-heal reconciliations for a single node. When a
 * node reconnects the control plane redeploys apps that should be running but
 * aren't; this cooldown prevents redeploy storms from flapping nodes.
 */
export const NODE_RECONCILE_COOLDOWN_MS = 120_000;
/**
 * Grace added to a command's own timeout before the reaper fails it. A command
 * still unfinished this long after issue is treated as dead (node offline/stuck).
 */
export const COMMAND_STALE_GRACE_MS = 60_000;

/** Node command polling. */
export const COMMAND_POLL_TIMEOUT_MS = 25_000;
export const COMMAND_DEFAULT_TIMEOUT_MS = 300_000;
export const COMMAND_MAX_TIMEOUT_MS = 3_600_000;

/** Join token defaults. */
export const JOIN_TOKEN_TTL_MS = 15 * 60_000; // 15 minutes
export const JOIN_TOKEN_BYTES = 32;

/** Agent auth token (issued after join). Rotated on demand. */
export const AGENT_TOKEN_BYTES = 40;

/** API token (personal / CI). */
export const API_TOKEN_BYTES = 32;
export const API_TOKEN_PREFIX = 'ys_';
export const JOIN_TOKEN_PREFIX = 'ysj_';
export const AGENT_TOKEN_PREFIX = 'ysa_';

/** Default plan limits (development plan). */
export const DEFAULT_PLAN = {
  key: 'dev',
  name: 'Developer',
  maxNodes: 3,
  maxApps: 10,
  maxDeploymentsPerDay: 100,
  logRetentionDays: 14,
} as const;

/** Container / image naming. */
export const CONTAINER_PREFIX = 'yourstack';
export const DOCKER_LABEL_NAMESPACE = 'io.yourstack';

/** Realtime SSE channels. */
export const SSE_CHANNELS = {
  deployment: (deploymentId: string) => `deployment:${deploymentId}`,
  app: (appId: string) => `app:${appId}`,
  node: (nodeId: string) => `node:${nodeId}`,
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
  pipeline: (runId: string) => `pipeline:${runId}`,
  database: (databaseId: string) => `database:${databaseId}`,
  bucket: (bucketId: string) => `bucket:${bucketId}`,
  fn: (functionId: string) => `function:${functionId}`,
  runnerPool: (poolId: string) => `runnerpool:${poolId}`,
  cron: (cronJobId: string) => `cron:${cronJobId}`,
  firewall: (firewallId: string) => `firewall:${firewallId}`,
  loadBalancer: (lbId: string) => `lb:${lbId}`,
  organization: (orgId: string) => `org:${orgId}`,
  /** Live metrics stream for any scoped target. */
  metrics: (scope: string, targetId: string) => `metrics:${scope}:${targetId}`,
} as const;

/** Secret redaction placeholder. */
export const REDACTED = '***REDACTED***';

/** Default healthcheck timing. */
export const HEALTHCHECK_DEFAULT_PATH = '/';
export const HEALTHCHECK_TIMEOUT_MS = 10_000;
export const HEALTHCHECK_RETRIES = 5;
export const HEALTHCHECK_INTERVAL_MS = 3_000;

/** Pagination. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
