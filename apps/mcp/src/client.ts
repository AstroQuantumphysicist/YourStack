/**
 * Thin YourStack API client for the MCP server. Authenticates with a personal
 * API token (`YOURSTACK_TOKEN`, a `ys_…` token created in the dashboard) against
 * `YOURSTACK_API_URL`.
 */
export class YourStackClient {
  private readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  static fromEnv(): YourStackClient {
    const baseUrl = process.env.YOURSTACK_API_URL ?? 'http://localhost:4000';
    const token = process.env.YOURSTACK_TOKEN ?? '';
    if (!token) {
      throw new Error('YOURSTACK_TOKEN is required (create a personal API token in the YourStack dashboard).');
    }
    return new YourStackClient(baseUrl, token);
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: string } }).error;
      throw new Error(`YourStack API ${res.status} ${err?.code ?? ''}: ${err?.message ?? text}`);
    }
    return json as T;
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  del<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }
}
