'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, Container, Github, Trash2 } from 'lucide-react';
import type { RunnerDTO, RunnerPoolDTO } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StatCard } from '@/components/dashboard/stat-card';
import { timeAgo, shortId } from '@/lib/format';

export default function RunnerPoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const pool = useSWR<{ pool: RunnerPoolDTO }>(`/runner-pools/${id}`);
  const runners = useSWR<{ runners: RunnerDTO[] }>(`/runner-pools/${id}/runners`);
  const [deleting, setDeleting] = useState(false);

  useSSE(`runner-pool:${id}`, {
    onEvent: (msg) => {
      if (msg.type === 'runner.status') {
        pool.mutate();
        runners.mutate();
      }
    },
  });

  const p = pool.data?.pool;
  const list = runners.data?.runners ?? [];

  const remove = async () => {
    if (!window.confirm(`Delete runner pool "${p?.name}"? Runners will be deregistered.`)) return;
    setDeleting(true);
    try {
      await api.deleteRunnerPool(id);
      toast.success('Runner pool deleted');
      router.push('/dashboard/runners');
    } catch (err) {
      toast.error('Could not delete pool', err instanceof ApiError ? err.message : undefined);
      setDeleting(false);
    }
  };

  if (pool.error && !p) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={pool.error instanceof ApiError ? pool.error.message : undefined} onRetry={() => pool.mutate()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={p ? p.name : <Skeleton className="h-7 w-40" />}
        description={
          p ? (
            <span className="flex items-center gap-1.5">
              <Github className="h-3.5 w-3.5" /> {p.githubScope}
            </span>
          ) : undefined
        }
        actions={
          <Button size="sm" variant="danger" loading={deleting} onClick={remove}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Active" value={p?.activeRunners ?? 0} icon={Container} loading={!p} accent="success" />
        <StatCard label="Busy" value={p?.busyRunners ?? 0} icon={Container} loading={!p} accent="info" />
        <StatCard label="Min" value={p?.minRunners ?? 0} icon={Container} loading={!p} />
        <StatCard label="Max" value={p?.maxRunners ?? 0} icon={Container} loading={!p} />
      </div>

      {p ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {p.labels.map((l) => (
            <Badge key={l} variant="outline">
              {l}
            </Badge>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Runners</CardTitle>
        </CardHeader>
        <CardContent>
          {runners.isLoading ? (
            <SkeletonRows rows={3} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Container}
              title="No runners online"
              description="Runners start automatically when jobs queue against this pool's labels."
            />
          ) : (
            <div className="divide-y divide-border">
              {list.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <span className="font-mono text-sm">{shortId(r.id)}</span>
                      <StatusBadge kind="runner" status={r.status} />
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.currentJob ? `Running: ${r.currentJob}` : 'Waiting for jobs'}
                      {r.nodeId ? ` · node ${shortId(r.nodeId)}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    seen {timeAgo(r.lastSeenAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/runners"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All runner pools
    </Link>
  );
}
