import { API_VERSION } from '@noderail/shared';
import type {
  AppDTO,
  DeploymentDTO,
  NodeDTO,
  ProjectDTO,
  SecretDTO,
  UserDTO,
  WorkspaceDTO,
} from '@noderail/shared';
import { apiError, CliError, networkError, type ApiErrorBody } from './errors.js';
import { streamSse, type SseEvent } from './sse.js';

export interface ClientOptions {
  apiUrl: string;
  token?: string;
}

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

export interface DeployResponse {
  deploymentId: string;
  version: number;
}

/** A stored log line as returned by the REST log endpoints. */
export interface StoredLog {
  id: string;
  severity: string;
  message: string;
  seq?: number;
  stream?: string;
  timestamp: string;
}

/**
 * Thin, typed wrapper over the NodeRail REST API. All requests target
 * `${apiUrl}/${API_VERSION}` and carry the personal API token as a Bearer
 * credential. Non-2xx responses are converted to friendly `CliError`s.
 */
export class ApiClient {
  readonly apiUrl: string;
  private readonly token?: string;

  constructor(opts: ClientOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
    this.token = opts.token;
  }

  /** Absolute base for the versioned API (e.g. `http://localhost:4000/v1`). */
  get base(): string {
    return `${this.apiUrl}/${API_VERSION}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.base}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(
          body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        ),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw networkError(err, this.apiUrl);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!res.ok) throw new CliError(`Request failed (${res.status}): ${text.slice(0, 200)}`);
        throw new CliError('The API returned a non-JSON response.');
      }
    }

    if (!res.ok) throw apiError(res.status, parsed as ApiErrorBody | null, url);
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // --- Typed endpoint helpers ------------------------------------------------

  me(): Promise<MeResponse> {
    return this.get<MeResponse>('/auth/me');
  }

  logout(): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>('/auth/logout', {});
  }

  listProjects(workspaceId: string): Promise<{ projects: ProjectDTO[] }> {
    return this.get(`/workspaces/${workspaceId}/projects`);
  }
  createProject(workspaceId: string, name: string): Promise<{ project: ProjectDTO }> {
    return this.post(`/workspaces/${workspaceId}/projects`, { name });
  }

  listApps(projectId: string): Promise<{ apps: AppDTO[] }> {
    return this.get(`/projects/${projectId}/apps`);
  }
  createApp(
    projectId: string,
    body: {
      name: string;
      repoUrl?: string;
      branch?: string;
      framework?: string;
      port?: number;
      buildCommand?: string;
      startCommand?: string;
      installCommand?: string;
      healthcheckPath?: string;
    },
  ): Promise<{ app: AppDTO }> {
    return this.post(`/projects/${projectId}/apps`, body);
  }
  getApp(appId: string): Promise<{ app: AppDTO }> {
    return this.get(`/apps/${appId}`);
  }
  deploy(appId: string, body: { ref?: string; reason?: string }): Promise<DeployResponse> {
    return this.post(`/apps/${appId}/deploy`, body);
  }
  rollback(appId: string, targetDeploymentId: string): Promise<{ ok: boolean; targetDeploymentId: string }> {
    return this.post(`/apps/${appId}/rollback`, { targetDeploymentId });
  }
  listDeployments(appId: string): Promise<{ deployments: DeploymentDTO[] }> {
    return this.get(`/apps/${appId}/deployments`);
  }

  createJoinToken(
    workspaceId: string,
    body: { label?: string; region?: string },
  ): Promise<JoinTokenResponse> {
    return this.post(`/workspaces/${workspaceId}/nodes/join-token`, body);
  }
  listNodes(workspaceId: string): Promise<{ nodes: NodeDTO[] }> {
    return this.get(`/workspaces/${workspaceId}/nodes`);
  }

  setAppSecret(appId: string, key: string, value: string): Promise<{ secret: SecretDTO }> {
    return this.post('/secrets', { scope: 'app', appId, key, value });
  }

  getAppLogs(
    appId: string,
    query: { since?: string; limit?: number; search?: string } = {},
  ): Promise<{ logs: StoredLog[] }> {
    const qs = new URLSearchParams();
    if (query.since) qs.set('since', query.since);
    if (query.limit) qs.set('limit', String(query.limit));
    if (query.search) qs.set('search', query.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.get(`/apps/${appId}/logs${suffix}`);
  }

  getDeploymentLogs(deploymentId: string, limit = 500): Promise<{ logs: StoredLog[] }> {
    return this.get(`/deployments/${deploymentId}/logs?limit=${limit}`);
  }

  // --- SSE ------------------------------------------------------------------

  /** Stream events for an SSE channel (e.g. `app:<id>`, `deployment:<id>`). */
  streamChannel(
    channel: string,
    onEvent: (evt: SseEvent) => void | boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${this.base}/events?channel=${encodeURIComponent(channel)}`;
    return streamSse(url, { headers: this.headers(), signal }, onEvent).catch((err) => {
      const status = (err as { status?: number }).status;
      if (status) {
        let body: ApiErrorBody | null = null;
        const raw = (err as { body?: string }).body;
        if (raw) {
          try {
            body = JSON.parse(raw) as ApiErrorBody;
          } catch {
            // ignore
          }
        }
        throw apiError(status, body, url);
      }
      throw networkError(err, this.apiUrl);
    });
  }
}
