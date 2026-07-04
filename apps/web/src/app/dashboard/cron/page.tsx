'use client';

import Link from 'next/link';
import { Clock, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceCron, useAutoCreate } from '@/lib/hooks';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { CreateCronDialog } from '@/components/dashboard/create-cron-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';
import { describeCron } from '@/lib/cron';

export default function CronPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useWorkspaceCron(wid);
  const [createOpen, setCreateOpen] = useAutoCreate();

  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'cron.status' || msg.type === 'cron.run') mutate();
    },
  });

  const cronJobs = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cron Jobs"
        description="Containers that run on a schedule — backups, syncs, reports and cleanup tasks."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New cron job
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load cron jobs." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : cronJobs.length === 0 ? (
        <EmptyIllustration
          icon={Clock}
          title="No cron jobs yet"
          description="Schedule a container to run on any cadence — from every minute to once a month. Track every run, retry on demand, and pause without deleting."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create cron job
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cronJobs.map((job) => {
            const readable = describeCron(job.schedule);
            return (
              <Link key={job.id} href={`/dashboard/cron/${job.id}`}>
                <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
                        <Clock className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{job.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{job.projectName}</p>
                      </div>
                    </div>
                    <StatusBadge kind="cron" status={job.status} />
                  </div>

                  <div className="mt-3 rounded-lg border border-border bg-surface-muted/40 px-2.5 py-1.5">
                    <p className="font-mono text-xs text-foreground">{job.schedule}</p>
                    {readable ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{readable}</p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {job.lastRunStatus ? (
                      <StatusBadge kind="cron" status={job.lastRunStatus} />
                    ) : (
                      <Badge variant="outline">no runs yet</Badge>
                    )}
                    {job.region ? <Badge variant="default">{job.region}</Badge> : null}
                  </div>

                  <p className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {job.nextRunAt ? `Next ${timeAgo(job.nextRunAt)}` : 'Not scheduled'}
                    </span>
                    <span>{job.lastRunAt ? `Ran ${timeAgo(job.lastRunAt)}` : '—'}</span>
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {wid ? (
        <CreateCronDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
