'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, Clock, History, Pause, Play, Terminal, Trash2 } from 'lucide-react';
import type { CronJobDTO } from '@yourstack/shared';
import { CronJobStatus } from '@yourstack/shared';
import { api, ApiError, type CronRun } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { formatDateFull, timeAgo } from '@/lib/format';
import { describeCron } from '@/lib/cron';

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

export default function CronDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR<{ cronJob: CronJobDTO }>(`/cron/${id}`);
  const runsQuery = useSWR<{ runs: CronRun[] }>(`/cron/${id}/runs`);
  const job = data?.cronJob;

  const [busy, setBusy] = useState<string | null>(null);

  useSSE(`cron:${id}`, {
    onEvent: (msg) => {
      if (msg.type === 'cron.status') mutate();
      if (msg.type === 'cron.run') {
        mutate();
        runsQuery.mutate();
      }
    },
  });

  const runNow = useCallback(async () => {
    setBusy('run');
    try {
      await api.runCron(id);
      toast.success('Run triggered', 'The job is executing now.');
      mutate();
      runsQuery.mutate();
    } catch (err) {
      toast.error('Could not trigger run', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [id, toast, mutate, runsQuery]);

  const togglePause = useCallback(async () => {
    if (!job) return;
    const paused = job.status !== CronJobStatus.PAUSED;
    setBusy('pause');
    try {
      await api.updateCron(id, { paused });
      toast.success(paused ? 'Cron job paused' : 'Cron job resumed');
      mutate();
    } catch (err) {
      toast.error('Could not update cron job', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [id, job, toast, mutate]);

  const remove = async () => {
    if (!window.confirm(`Delete cron job "${job?.name}"? This cannot be undone.`)) return;
    setBusy('delete');
    try {
      await api.deleteCron(id);
      toast.success('Cron job deleted');
      router.push('/dashboard/cron');
    } catch (err) {
      toast.error('Could not delete cron job', err instanceof ApiError ? err.message : undefined);
      setBusy(null);
    }
  };

  if (error && !job) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => mutate()} />
      </div>
    );
  }

  const paused = job?.status === CronJobStatus.PAUSED;
  const readable = job ? describeCron(job.schedule) : null;
  const runs = runsQuery.data?.runs ?? [];

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
              <Clock className="h-4 w-4" />
            </span>
            {isLoading || !job ? <Skeleton className="h-7 w-40" /> : job.name}
            {job ? <StatusBadge kind="cron" status={job.status} /> : null}
          </span>
        }
        description={job ? (readable ? `${job.schedule} · ${readable}` : job.schedule) : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={busy === 'run'} disabled={!!busy || !job} onClick={runNow}>
              <Play className="h-4 w-4" /> Run now
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'pause'}
              disabled={!!busy || !job}
              onClick={togglePause}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="danger" loading={busy === 'delete'} disabled={!!busy} onClick={remove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> Recent runs
            </CardTitle>
            {runs.length > 0 ? (
              <span className="text-xs text-muted-foreground">{runs.length} runs</span>
            ) : null}
          </CardHeader>
          <CardContent>
            {runsQuery.error ? (
              <ErrorState message="Could not load runs." onRetry={() => runsQuery.mutate()} />
            ) : runsQuery.isLoading ? (
              <SkeletonRows rows={4} />
            ) : runs.length === 0 ? (
              <EmptyState
                icon={History}
                title="No runs yet"
                description="Trigger a run now or wait for the next scheduled execution."
              />
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <StatusBadge kind="cron" status={run.status} />
                      <span className="truncate text-xs text-muted-foreground">
                        {run.startedAt ? formatDateFull(run.startedAt) : 'not started'}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatDuration(run.durationMs)}</span>
                      <Badge variant={run.exitCode === 0 ? 'success' : run.exitCode == null ? 'default' : 'danger'}>
                        exit {run.exitCode ?? '—'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Spec label="Project" value={job?.projectId ? job.projectId.slice(0, 10) : '—'} />
            <Spec label="Region" value={job?.region ?? 'Auto'} />
            <Spec label="Next run" value={job?.nextRunAt ? timeAgo(job.nextRunAt) : '—'} />
            <Spec label="Last run" value={job?.lastRunAt ? timeAgo(job.lastRunAt) : 'never'} />
            <Spec label="Created" value={job ? formatDateFull(job.createdAt) : '—'} />
            <div className="border-t border-border pt-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Terminal className="h-3.5 w-3.5" /> Image
              </p>
              <p className="break-all font-mono text-xs text-foreground">{job?.image ?? '—'}</p>
              {job?.command ? (
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                  $ {job.command}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/cron"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All cron jobs
    </Link>
  );
}
