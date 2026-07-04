import type {
  AppDTO,
  AuditLogDTO,
  ApiTokenDTO,
  BucketDTO,
  DatabaseDTO,
  DeploymentDTO,
  DomainDTO,
  FunctionDTO,
  GitRepositoryDTO,
  MemberDTO,
  MetricSeries,
  NodeDTO,
  PipelineRunDTO,
  ProjectDTO,
  RegionDTO,
  RunnerDTO,
  RunnerPoolDTO,
  ScalingPolicyDTO,
  SecretDTO,
  UserDTO,
  WorkspaceDTO,
  WorkspaceStatsDTO,
} from '@yourstack/shared';

/** Resolved base URL of the control-plane API. All routes live under `/v1`. */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4000';

export const API_V1 = `${API_BASE}/v1`;

/** Shape of the API's error envelope: `{ error: { code, message, ... } }`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** When true a 401 will NOT auto-redirect (used by the auth bootstrap). */
  noRedirect?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = withQuery(`${API_V1}${path}`, opts.query);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      // Cookie session — every request must carry the session cookie.
      credentials: 'include',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'network_error',
      'Could not reach the YourStack API. Is it running?',
    );
  }

  if (res.status === 401 && !opts.noRedirect && typeof window !== 'undefined') {
    // Session expired or missing — bounce to login (preserving the intent).
    const here = window.location.pathname + window.location.search;
    if (!here.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(here)}`;
    }
    throw new ApiError(401, 'unauthorized', 'Authentication required');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const body = data as ApiErrorBody | undefined;
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/* ------------------------------ Response shapes ----------------------------- */

export interface MeResponse {
  user: UserDTO;
  workspaces: WorkspaceDTO[];
}

export interface JoinTokenResponse {
  joinToken: string;
  expiresAt: string;
  apiUrl: string;
  installCommand: string;
}

export interface DeploymentDetail {
  deployment: DeploymentDTO;
  pipelineRun: PipelineRunDTO | null;
}

export interface DeploymentLogLine {
  id: string;
  stream: string;
  severity: string;
  message: string;
  seq: number;
  timestamp: string;
}

export interface RuntimeLogLine {
  id: string;
  severity: string;
  message: string;
  timestamp: string;
}

export interface NodeAppSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string;
}

export interface HeartbeatPoint {
  cpuUsagePercent: number | null;
  memoryUsedMb: number | null;
  diskUsedMb: number | null;
  runningApps: number;
  timestamp: string;
}

export interface GithubRepo {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  url: string;
}

export interface DnsInstructions {
  recordType: string;
  name: string;
  value: string;
  note: string;
}

export interface AdminStats {
  users: number;
  workspaces: number;
  nodes: number;
  onlineNodes: number;
  apps: number;
  deployments: number;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  status: string;
  planKey: string;
  members: number;
  projects: number;
  nodes: number;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface AdminNode {
  id: string;
  name: string;
  status: string;
  disabled: boolean;
  workspace: string;
  lastHeartbeatAt: string | null;
}

/* ----------------------- Managed-resource response shapes ------------------- */

export interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  connectionString: string;
}

export interface BucketCredentials {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export interface FunctionInvocation {
  id: string;
  status: string;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

/** Metric scope + kinds mirror @yourstack/shared MetricScope / MetricKind. */
export type MetricScopeName = 'app' | 'node' | 'database' | 'function';

export interface MetricsQuery {
  scope: MetricScopeName;
  targetId: string;
  kinds?: string[];
  windowSeconds?: number;
  stepSeconds?: number;
}

/* --------------------------------- Client ---------------------------------- */

export const api = {
  raw: request,

  // Auth
  me: (signal?: AbortSignal) =>
    request<MeResponse>('/auth/me', { noRedirect: true, signal }),
  devLogin: (email: string, name?: string) =>
    request<{ user: UserDTO }>('/auth/dev-login', {
      method: 'POST',
      body: { email, name },
      noRedirect: true,
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  // Workspaces
  createWorkspace: (name: string) =>
    request<{ workspace: WorkspaceDTO }>('/workspaces', { method: 'POST', body: { name } }),
  workspace: (id: string) => request<{ workspace: WorkspaceDTO }>(`/workspaces/${id}`),
  updateWorkspace: (id: string, name: string) =>
    request<{ workspace: WorkspaceDTO }>(`/workspaces/${id}`, { method: 'PATCH', body: { name } }),
  workspaceStats: (id: string) =>
    request<{ stats: WorkspaceStatsDTO }>(`/workspaces/${id}/stats`),
  members: (id: string) => request<{ members: MemberDTO[] }>(`/workspaces/${id}/members`),
  inviteMember: (id: string, email: string, role: string) =>
    request<{ member: MemberDTO }>(`/workspaces/${id}/members`, {
      method: 'POST',
      body: { email, role },
    }),
  updateMemberRole: (id: string, memberId: string, role: string) =>
    request<{ member: MemberDTO }>(`/workspaces/${id}/members/${memberId}`, {
      method: 'PATCH',
      body: { role },
    }),
  removeMember: (id: string, memberId: string) =>
    request<void>(`/workspaces/${id}/members/${memberId}`, { method: 'DELETE' }),
  audit: (id: string, limit = 100) =>
    request<{ logs: AuditLogDTO[] }>(`/workspaces/${id}/audit`, { query: { limit } }),

  // Tokens
  tokens: (wid: string) => request<{ tokens: ApiTokenDTO[] }>(`/workspaces/${wid}/tokens`),
  createToken: (wid: string, name: string, expiresInDays?: number) =>
    request<{ token: ApiTokenDTO; plaintext: string }>(`/workspaces/${wid}/tokens`, {
      method: 'POST',
      body: { name, expiresInDays },
    }),
  revokeToken: (wid: string, id: string) =>
    request<void>(`/workspaces/${wid}/tokens/${id}`, { method: 'DELETE' }),

  // Projects
  projects: (wid: string) => request<{ projects: ProjectDTO[] }>(`/workspaces/${wid}/projects`),
  createProject: (wid: string, body: { name: string; description?: string }) =>
    request<{ project: ProjectDTO }>(`/workspaces/${wid}/projects`, { method: 'POST', body }),

  // Apps
  projectApps: (pid: string) => request<{ apps: AppDTO[] }>(`/projects/${pid}/apps`),
  createApp: (pid: string, body: Record<string, unknown>) =>
    request<{ app: AppDTO }>(`/projects/${pid}/apps`, { method: 'POST', body }),
  app: (id: string) => request<{ app: AppDTO }>(`/apps/${id}`),
  updateApp: (id: string, body: Record<string, unknown>) =>
    request<{ app: AppDTO }>(`/apps/${id}`, { method: 'PATCH', body }),
  deleteApp: (id: string) => request<void>(`/apps/${id}`, { method: 'DELETE' }),
  deployApp: (id: string, body?: { ref?: string; reason?: string }) =>
    request<{ deploymentId: string; version: number }>(`/apps/${id}/deploy`, {
      method: 'POST',
      body: body ?? {},
    }),
  stopApp: (id: string) => request<{ commandId: string }>(`/apps/${id}/stop`, { method: 'POST' }),
  restartApp: (id: string) =>
    request<{ commandId: string }>(`/apps/${id}/restart`, { method: 'POST' }),
  rollbackApp: (id: string, targetDeploymentId: string) =>
    request<{ ok: true; targetDeploymentId: string }>(`/apps/${id}/rollback`, {
      method: 'POST',
      body: { targetDeploymentId },
    }),
  appDeployments: (id: string) =>
    request<{ deployments: DeploymentDTO[] }>(`/apps/${id}/deployments`),
  appLogs: (id: string, query?: { limit?: number; search?: string; severity?: string }) =>
    request<{ logs: RuntimeLogLine[] }>(`/apps/${id}/logs`, { query }),
  appDomains: (id: string) => request<{ domains: DomainDTO[] }>(`/apps/${id}/domains`),
  createDomain: (id: string, hostname: string) =>
    request<{ domain: DomainDTO; instructions: DnsInstructions }>(`/apps/${id}/domains`, {
      method: 'POST',
      body: { hostname },
    }),

  // Deployments
  deployment: (id: string) => request<DeploymentDetail>(`/deployments/${id}`),
  deploymentLogs: (id: string, limit = 500) =>
    request<{ logs: DeploymentLogLine[] }>(`/deployments/${id}/logs`, { query: { limit } }),

  // Domains
  verifyDomain: (id: string) =>
    request<{ ok: true; status: string }>(`/domains/${id}/verify`, { method: 'POST' }),
  deleteDomain: (id: string) => request<void>(`/domains/${id}`, { method: 'DELETE' }),

  // Nodes
  nodes: (wid: string) => request<{ nodes: NodeDTO[] }>(`/workspaces/${wid}/nodes`),
  joinToken: (wid: string, body?: { label?: string; region?: string }) =>
    request<JoinTokenResponse>(`/workspaces/${wid}/nodes/join-token`, {
      method: 'POST',
      body: body ?? {},
    }),
  node: (id: string) => request<{ node: NodeDTO }>(`/nodes/${id}`),
  nodeApps: (id: string) => request<{ apps: NodeAppSummary[] }>(`/nodes/${id}/apps`),
  nodeHeartbeats: (id: string) =>
    request<{ heartbeats: HeartbeatPoint[] }>(`/nodes/${id}/heartbeats`),
  updateNode: (id: string, body: { name?: string; region?: string }) =>
    request<{ node: NodeDTO }>(`/nodes/${id}`, { method: 'PATCH', body }),
  setNodeLabel: (id: string, key: string, value: string) =>
    request<{ node: NodeDTO }>(`/nodes/${id}/labels`, { method: 'POST', body: { key, value } }),
  removeNodeLabel: (id: string, key: string) =>
    request<void>(`/nodes/${id}/labels/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  drainNode: (id: string) => request<{ node: NodeDTO }>(`/nodes/${id}/drain`, { method: 'POST' }),
  removeNode: (id: string) => request<void>(`/nodes/${id}`, { method: 'DELETE' }),

  // Secrets
  secrets: (query: { appId?: string; projectId?: string; environmentId?: string }) =>
    request<{ secrets: SecretDTO[] }>('/secrets', { query }),
  createSecret: (body: {
    scope: string;
    key: string;
    value: string;
    appId?: string;
    projectId?: string;
    environmentId?: string;
  }) => request<{ secret: SecretDTO }>('/secrets', { method: 'POST', body }),
  updateSecret: (id: string, value: string) =>
    request<{ secret: SecretDTO }>(`/secrets/${id}`, { method: 'PATCH', body: { value } }),
  deleteSecret: (id: string) => request<void>(`/secrets/${id}`, { method: 'DELETE' }),

  // GitHub / repos
  githubRepos: () => request<{ repos: GithubRepo[] }>('/github/repos'),
  connectedRepos: (wid: string) =>
    request<{ repos: GitRepositoryDTO[] }>(`/workspaces/${wid}/repos`),
  connectRepo: (wid: string, body: Record<string, unknown>) =>
    request<{ repo: GitRepositoryDTO }>(`/workspaces/${wid}/repos`, { method: 'POST', body }),

  // Admin
  adminStats: () => request<{ stats: AdminStats }>('/admin/stats'),
  adminWorkspaces: () => request<{ workspaces: AdminWorkspace[] }>('/admin/workspaces'),
  adminUsers: () => request<{ users: AdminUser[] }>('/admin/users'),
  adminNodes: () => request<{ nodes: AdminNode[] }>('/admin/nodes'),
  adminAudit: () => request<{ logs: AuditLogDTO[] }>('/admin/audit'),
  suspendWorkspace: (id: string, suspend: boolean) =>
    request<{ status: string }>(`/admin/workspaces/${id}/suspend`, {
      method: 'POST',
      body: { suspend },
    }),
  disableNode: (id: string, disable: boolean) =>
    request<{ disabled: boolean }>(`/admin/nodes/${id}/disable`, {
      method: 'POST',
      body: { disable },
    }),

  // Databases (v2)
  databases: (pid: string) =>
    request<{ databases: DatabaseDTO[] }>(`/projects/${pid}/databases`),
  createDatabase: (pid: string, body: Record<string, unknown>) =>
    request<{ database: DatabaseDTO }>(`/projects/${pid}/databases`, { method: 'POST', body }),
  database: (id: string) => request<{ database: DatabaseDTO }>(`/databases/${id}`),
  databaseCredentials: (id: string) =>
    request<{ credentials: DatabaseCredentials }>(`/databases/${id}/credentials`),
  backupDatabase: (id: string) =>
    request<{ commandId: string }>(`/databases/${id}/backup`, { method: 'POST' }),
  stopDatabase: (id: string) =>
    request<{ commandId: string }>(`/databases/${id}/stop`, { method: 'POST' }),
  startDatabase: (id: string) =>
    request<{ commandId: string }>(`/databases/${id}/start`, { method: 'POST' }),
  deleteDatabase: (id: string) => request<void>(`/databases/${id}`, { method: 'DELETE' }),

  // Storage / buckets (v2)
  buckets: (pid: string) => request<{ buckets: BucketDTO[] }>(`/projects/${pid}/buckets`),
  createBucket: (pid: string, body: Record<string, unknown>) =>
    request<{ bucket: BucketDTO }>(`/projects/${pid}/buckets`, { method: 'POST', body }),
  bucket: (id: string) => request<{ bucket: BucketDTO }>(`/buckets/${id}`),
  bucketCredentials: (id: string) =>
    request<{ credentials: BucketCredentials }>(`/buckets/${id}/credentials`),
  deleteBucket: (id: string) => request<void>(`/buckets/${id}`, { method: 'DELETE' }),

  // Functions (v2)
  functions: (pid: string) => request<{ functions: FunctionDTO[] }>(`/projects/${pid}/functions`),
  createFunction: (pid: string, body: Record<string, unknown>) =>
    request<{ function: FunctionDTO }>(`/projects/${pid}/functions`, { method: 'POST', body }),
  functionResource: (id: string) => request<{ function: FunctionDTO }>(`/functions/${id}`),
  invokeFunction: (id: string, payload: unknown) =>
    request<{ commandId: string }>(`/functions/${id}/invoke`, {
      method: 'POST',
      body: { payload },
    }),
  functionInvocations: (id: string) =>
    request<{ invocations: FunctionInvocation[] }>(`/functions/${id}/invocations`),
  deleteFunction: (id: string) => request<void>(`/functions/${id}`, { method: 'DELETE' }),

  // Runner pools (v2)
  runnerPools: (wid: string) =>
    request<{ pools: RunnerPoolDTO[] }>(`/workspaces/${wid}/runner-pools`),
  createRunnerPool: (wid: string, body: Record<string, unknown>) =>
    request<{ pool: RunnerPoolDTO }>(`/workspaces/${wid}/runner-pools`, { method: 'POST', body }),
  runnerPool: (id: string) => request<{ pool: RunnerPoolDTO }>(`/runner-pools/${id}`),
  poolRunners: (id: string) => request<{ runners: RunnerDTO[] }>(`/runner-pools/${id}/runners`),
  deleteRunnerPool: (id: string) => request<void>(`/runner-pools/${id}`, { method: 'DELETE' }),

  // Autoscaling (v2)
  scaling: (appId: string) =>
    request<{ policy: ScalingPolicyDTO | null }>(`/apps/${appId}/scaling`),
  updateScaling: (appId: string, body: Record<string, unknown>) =>
    request<{ policy: ScalingPolicyDTO }>(`/apps/${appId}/scaling`, { method: 'PUT', body }),

  // Regions (v2)
  regions: () => request<{ regions: RegionDTO[] }>('/regions'),

  // Metrics (v2)
  metrics: (q: MetricsQuery) =>
    request<{ series: MetricSeries[] }>('/metrics', {
      query: {
        scope: q.scope,
        targetId: q.targetId,
        kinds: q.kinds?.join(','),
        windowSeconds: q.windowSeconds,
        stepSeconds: q.stepSeconds,
      },
    }),
};

/** SWR fetcher: a plain path (e.g. "/apps/123") is fetched via the client. */
export const swrFetcher = <T>(path: string): Promise<T> => request<T>(path);
