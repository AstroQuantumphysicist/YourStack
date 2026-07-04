'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Check, GitBranch, Github, Lock, Plus, RefreshCw, Webhook } from 'lucide-react';
import type { GitRepositoryDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { useWorkspaceDeployments } from '@/lib/hooks';
import { api, ApiError, type GithubRepo } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
        description="Connect GitHub repositories to build and deploy on every push."
        actions={
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4" /> Connect repository
          </Button>
        }
      />

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
              ? 'Connect your GitHub account first — sign in with GitHub to grant repo access.'
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
