import { request } from 'undici';
import type { AppConfig } from '@noderail/config';

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
  html_url: string;
}

/**
 * Minimal GitHub integration. Uses OAuth (user access token) for repo listing
 * and commit statuses. Documents the GitHub App upgrade path in docs/SECURITY.md
 * — a GitHub App would provide finer-grained installation tokens and check runs.
 */
export class GithubClient {
  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return this.config.githubConfigured;
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.GITHUB_CLIENT_ID ?? '',
      redirect_uri: `${this.config.PUBLIC_API_URL}/v1/auth/github/callback`,
      scope: 'read:user user:email repo',
      state,
      allow_signup: 'true',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; scope: string }> {
    const res = await request('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.GITHUB_CLIENT_ID,
        client_secret: this.config.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${this.config.PUBLIC_API_URL}/v1/auth/github/callback`,
      }),
    });
    const body = (await res.body.json()) as {
      access_token?: string;
      scope?: string;
      error_description?: string;
    };
    if (!body.access_token) {
      throw new Error(body.error_description ?? 'GitHub token exchange failed');
    }
    return { accessToken: body.access_token, scope: body.scope ?? '' };
  }

  private async api<T>(token: string, path: string, init?: Parameters<typeof request>[1]): Promise<T> {
    const res = await request(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'NodeRail',
        'x-github-api-version': '2022-11-28',
        ...(init?.headers as Record<string, string>),
      },
    });
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`GitHub API ${res.statusCode}: ${text}`);
    }
    return (await res.body.json()) as T;
  }

  getUser(token: string): Promise<GithubUser> {
    return this.api<GithubUser>(token, '/user');
  }

  async getPrimaryEmail(token: string): Promise<string | null> {
    try {
      const emails = await this.api<Array<{ email: string; primary: boolean; verified: boolean }>>(
        token,
        '/user/emails',
      );
      return emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
    } catch {
      return null;
    }
  }

  listRepos(token: string, page = 1): Promise<GithubRepo[]> {
    return this.api<GithubRepo[]>(
      token,
      `/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`,
    );
  }

  /** Create a commit status (pending/success/failure). Best-effort. */
  async createCommitStatus(
    token: string,
    fullName: string,
    sha: string,
    state: 'pending' | 'success' | 'failure' | 'error',
    opts: { targetUrl?: string; description?: string; context?: string } = {},
  ): Promise<void> {
    await this.api(token, `/repos/${fullName}/statuses/${sha}`, {
      method: 'POST',
      body: JSON.stringify({
        state,
        target_url: opts.targetUrl,
        description: opts.description?.slice(0, 140),
        context: opts.context ?? 'noderail/deploy',
      }),
    });
  }

  /** Register a repo push webhook. Returns the webhook id. */
  async createWebhook(token: string, fullName: string, secret: string): Promise<string> {
    const hook = await this.api<{ id: number }>(token, `/repos/${fullName}/hooks`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: {
          url: `${this.config.PUBLIC_API_URL}/v1/webhooks/github`,
          content_type: 'json',
          secret,
          insecure_ssl: '0',
        },
      }),
    });
    return String(hook.id);
  }
}
