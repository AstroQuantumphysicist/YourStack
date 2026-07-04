import { createSign } from 'node:crypto';
import { request } from 'undici';
import type { AppConfig } from '@yourstack/config';

/**
 * Normalize a GitHub App private key. The key is provided via
 * `GITHUB_APP_PRIVATE_KEY` either as a raw PEM (possibly with escaped `\n`
 * newlines when set through a single-line env var) or as a base64-encoded PEM.
 * Returns a PEM string suitable for `crypto.createSign`.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('-----BEGIN')) {
    // Already PEM; un-escape literal "\n" sequences from single-line env vars.
    return trimmed.replace(/\\n/g, '\n');
  }
  // Otherwise assume the whole PEM was base64-encoded.
  return Buffer.from(trimmed, 'base64').toString('utf8').trim();
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

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

/** A GitHub App installation as returned by GET /app/installations/{id}. */
export interface GithubInstallationApi {
  id: number;
  account: { login: string; id: number; type: string } | null;
  repository_selection: 'all' | 'selected';
  repositories?: GithubRepo[];
}

export interface CheckRunOptions {
  status?: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out';
  title?: string;
  summary?: string;
  detailsUrl?: string;
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
        'user-agent': 'YourStack',
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
        context: opts.context ?? 'yourstack/deploy',
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

  /* ------------------------------- GitHub App ------------------------------- */

  get appConfigured(): boolean {
    return this.config.githubAppConfigured;
  }

  /** URL that starts the App installation flow, carrying a signed `state`. */
  appInstallUrl(state: string): string {
    const params = new URLSearchParams({ state });
    return `https://github.com/apps/${this.config.GITHUB_APP_SLUG ?? ''}/installations/new?${params.toString()}`;
  }

  /**
   * Mint a short-lived app JWT (RS256 over {iat,exp,iss}) used to authenticate
   * as the App itself (list installations, mint installation tokens). Signed with
   * the App's private key — no external dependency, just node:crypto.
   */
  private appJwt(): string {
    if (!this.config.GITHUB_APP_ID || !this.config.GITHUB_APP_PRIVATE_KEY) {
      throw new Error('GitHub App is not configured');
    }
    const pem = normalizePrivateKey(this.config.GITHUB_APP_PRIVATE_KEY);
    const now = Math.floor(Date.now() / 1000);
    const header = b64urlJson({ alg: 'RS256', typ: 'JWT' });
    // Clock-skew tolerant window; GitHub allows a max exp of 10 minutes.
    const payload = b64urlJson({ iat: now - 60, exp: now + 9 * 60, iss: this.config.GITHUB_APP_ID });
    const signingInput = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(pem).toString('base64url');
    return `${signingInput}.${signature}`;
  }

  /** Fetch an installation's metadata (app-authenticated). */
  getInstallation(installationId: string | number): Promise<GithubInstallationApi> {
    return this.api<GithubInstallationApi>(this.appJwt(), `/app/installations/${installationId}`);
  }

  /** Exchange the app JWT for an installation access token (repo-scoped). */
  async createInstallationToken(installationId: string | number): Promise<string> {
    const res = await this.api<{ token: string; expires_at: string }>(
      this.appJwt(),
      `/app/installations/${installationId}/access_tokens`,
      { method: 'POST' },
    );
    return res.token;
  }

  /** List repositories accessible to an installation (installation-token auth). */
  async listInstallationRepos(installationToken: string): Promise<GithubRepo[]> {
    const res = await this.api<{ repositories: GithubRepo[] }>(
      installationToken,
      '/installation/repositories?per_page=100',
    );
    return res.repositories ?? [];
  }

  /**
   * Create a check run for a commit (installation-token auth). Best-effort — the
   * caller swallows failures so a missing checks permission never blocks a deploy.
   */
  async createCheckRun(
    installationToken: string,
    fullName: string,
    headSha: string,
    name: string,
    opts: CheckRunOptions = {},
  ): Promise<void> {
    const body: Record<string, unknown> = {
      name,
      head_sha: headSha,
      status: opts.status ?? 'in_progress',
      details_url: opts.detailsUrl,
    };
    if (opts.status === 'completed' || opts.conclusion) {
      body.status = 'completed';
      body.conclusion = opts.conclusion ?? 'neutral';
      body.completed_at = new Date().toISOString();
    }
    if (opts.title || opts.summary) {
      body.output = { title: opts.title ?? name, summary: opts.summary ?? '' };
    }
    await this.api(installationToken, `/repos/${fullName}/check-runs`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
