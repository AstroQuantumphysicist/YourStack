'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Building2,
  Check,
  ExternalLink,
  GitBranch,
  Github,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  User,
  Webhook,
  Zap,
} from 'lucide-react';
import type { GithubInstallationDTO, GitRepositoryDTO } from '@yourstack/shared';
import { GithubAccountType } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { useWorkspaceDeployments } from '@/lib/hooks';
import { api, ApiError, type GithubRepo } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';

export default function CicdPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;

  const connected = useSWR<{ repos: GitRepositoryDTO[] }>(wid ? `/workspaces/${wid}/repos` : null);
  const runs = useWorkspaceDeployments(wid);
  const [connectOpen, setConnectOpen] = useState(false);

  const repos = connected.data?.repos ?? [];
  const recent = (runs.data?.deployments ?? []).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="CI/CD"
        description="Connect GitHub to build and deploy on every push."
        actions={
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4" /> Connect repository
          </Button>
        }
      />

      {wid ? <GithubAppCard wid={wid} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-4 w-4 text-primary" /> Connected repositories
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connected.error ? (
              <ErrorState message="Could not load repositories." onRetry={() => connected.mutate()} />
            ) : connected.isLoading ? (
              <SkeletonRows rows={3} />
            ) : repos.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="No repositories connected"
                description="Connect a GitHub repo to enable push-to-deploy pipelines."
                action={
                  <Button size="sm" onClick={() => setConnectOpen(true)}>
                    <Plus className="h-4 w-4" /> Connect repository
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {repos.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium text-foreground">
                        {r.private ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                        {r.fullName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        default branch {r.defaultBranch} · added {timeAgo(r.createdAt)}
                      </p>
                    </div>
                    <Badge variant={r.webhookActive ? 'success' : 'default'} className="gap-1">
                      <Webhook className="h-3 w-3" />
                      {r.webhookActive ? 'webhook active' : 'no webhook'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" /> Recent runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {runs.isLoading ? (
              <SkeletonRows rows={4} />
            ) : recent.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No pipeline runs yet.</p>
            ) : (
              <div className="space-y-2">
                {recent.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{d.appName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">v{d.version}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge kind="deployment" status={d.status} />
                      <span className="text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {wid ? (
        <ConnectRepoDialog
          wid={wid}
          open={connectOpen}
          onClose={() => setConnectOpen(false)}
          onConnected={() => connected.mutate()}
          existing={repos.map((r) => r.fullName)}
        />
      ) : null}
    </div>
  );
}

function GithubAppCard({ wid }: { wid: string }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR(
    ['github-installations', wid],
    () => api.githubInstallations(wid),
  );
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // Surface the post-install redirect (`?installed=1`) as a success toast, then
  // strip the query param so a refresh doesn't re-fire it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('installed') === '1') {
      toast.success('GitHub App installed', 'Pushes to connected repos now auto-deploy.');
      window.history.replaceState(null, '', window.location.pathname);
      mutate();
    }
    // Only run once on mount — the install redirect is a one-shot signal.
  }, [mutate, toast]);

  const install = async () => {
    setInstalling(true);
    try {
      const { url } = await api.githubAppInstallUrl(wid);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error('Could not start installation', err instanceof ApiError ? err.message : undefined);
    } finally {
      setInstalling(false);
    }
  };

  const remove = async (inst: GithubInstallationDTO) => {
    if (
      !window.confirm(
        `Remove the GitHub App from ${inst.accountLogin}? Repos under it will stop auto-deploying.`,
      )
    )
      return;
    setRemoving(inst.id);
    try {
      await api.removeGithubInstallation(inst.id);
      toast.success('Installation removed', inst.accountLogin);
      mutate();
    } catch (err) {
      toast.error('Could not remove installation', err instanceof ApiError ? err.message : undefined);
    } finally {
      setRemoving(null);
    }
  };

  const installations = data?.installations ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border bg-gradient-to-br from-primary/5 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground">
            <Github className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              GitHub App
            </h3>
            <p className="mt-0.5 max-w-md text-sm text-muted-foreground">
              Install the YourStack GitHub App to grant repo access. Pushes to connected repos
              build and deploy automatically — no webhooks to wire up.
            </p>
          </div>
        </div>
        <Button onClick={install} loading={installing} className="shrink-0">
          <ExternalLink className="h-4 w-4" /> Install GitHub App
        </Button>
      </div>

      <CardContent className="pt-5">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-primary" /> Installations
        </p>
        {error ? (
          <ErrorState message="Could not load installations." onRetry={() => mutate()} />
        ) : isLoading ? (
          <SkeletonRows rows={2} />
        ) : installations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-3 py-4 text-sm text-muted-foreground">
            No installations yet. Install the app above to connect an organization or user account.
          </p>
        ) : (
          <div className="space-y-2">
            {installations.map((inst) => {
              const isOrg = inst.accountType === GithubAccountType.ORGANIZATION;
              return (
                <div
                  key={inst.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      src={`https://github.com/${inst.accountLogin}.png`}
                      name={inst.accountLogin}
                      size={34}
                    />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium text-foreground">
                        {inst.accountLogin}
                        <Badge variant="outline" className="gap-1">
                          {isOrg ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {isOrg ? 'Organization' : 'User'}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {inst.repositoryCount}{' '}
                        {inst.repositorySelection === 'all' ? 'repos (all)' : 'repos selected'} ·
                        installed {timeAgo(inst.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={removing === inst.id}
                    onClick={() => remove(inst)}
                    aria-label={`Remove ${inst.accountLogin}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectRepoDialog({
  wid,
  open,
  onClose,
  onConnected,
  existing,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
  existing: string[];
}) {
  const toast = useToast();
  const { data, error, isLoading } = useSWR<{ repos: GithubRepo[] }>(
    open ? '/github/repos' : null,
    () => api.githubRepos(),
    { shouldRetryOnError: false },
  );
  const [connecting, setConnecting] = useState<string | null>(null);

  const connect = async (repo: GithubRepo) => {
    setConnecting(repo.externalId);
    try {
      await api.connectRepo(wid, {
        externalId: repo.externalId,
        owner: repo.owner,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
        private: repo.private,
        installWebhook: true,
      });
      toast.success('Repository connected', repo.fullName);
      onConnected();
    } catch (err) {
      toast.error('Could not connect repo', err instanceof ApiError ? err.message : undefined);
    } finally {
      setConnecting(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect a GitHub repository"
      description="Pick a repository to enable push-to-deploy. A webhook is installed automatically."
      className="max-w-xl"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {error ? (
        <div className="py-4">
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
            {error instanceof ApiError && error.code === 'bad_request'
              ? 'Connect your GitHub account first — install the GitHub App above to grant repo access.'
              : 'Could not load your GitHub repositories.'}
          </div>
        </div>
      ) : isLoading ? (
        <div className="py-2">
          <SkeletonRows rows={5} />
        </div>
      ) : (
        <div className="max-h-96 space-y-1.5 overflow-y-auto py-2">
          {(data?.repos ?? []).map((repo) => {
            const already = existing.includes(repo.fullName);
            return (
              <div
                key={repo.externalId}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                    {repo.private ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    {repo.fullName}
                  </p>
                  <p className="text-xs text-muted-foreground">{repo.defaultBranch}</p>
                </div>
                {already ? (
                  <Badge variant="success" className="gap-1">
                    <Check className="h-3 w-3" /> Connected
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={connecting === repo.externalId}
                    onClick={() => connect(repo)}
                  >
                    Connect
                  </Button>
                )}
              </div>
            );
          })}
          {(data?.repos ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No repositories found for your GitHub account.
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
