'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Container, Github, Plus } from 'lucide-react';
import type { RunnerPoolDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { useAutoCreate } from '@/lib/hooks';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { CreateRunnerPoolDialog } from '@/components/dashboard/create-runner-pool-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { pluralize, timeAgo } from '@/lib/format';

export default function RunnersPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useSWR<{ pools: RunnerPoolDTO[] }>(
    wid ? `/workspaces/${wid}/runner-pools` : null,
  );
  const [createOpen, setCreateOpen] = useAutoCreate();

  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'runner.status') mutate();
    },
  });

  const pools = data?.pools ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="CI Runners"
        description="Self-hosted GitHub Actions runner pools that autoscale across your nodes."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New runner pool
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load runner pools." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} />
      ) : pools.length === 0 ? (
        <EmptyIllustration
          icon={Container}
          title="No runner pools"
          description="Register a pool of self-hosted runners for an org or repo. YourStack starts and stops them on your nodes as jobs queue and drain."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create runner pool
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {pools.map((pool) => {
            const capacity = pool.maxRunners > 0 ? (pool.activeRunners / pool.maxRunners) * 100 : 0;
            return (
              <Link key={pool.id} href={`/dashboard/runners/${pool.id}`}>
                <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{pool.name}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <Github className="h-3.5 w-3.5" /> {pool.githubScope}
                      </p>
                    </div>
                    <Badge variant={pool.busyRunners > 0 ? 'info' : 'default'}>
                      {pool.busyRunners > 0 ? `${pool.busyRunners} busy` : 'idle'}
                    </Badge>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Active runners</span>
                      <span className="tabular-nums text-foreground">
                        {pool.activeRunners} / {pool.maxRunners}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min(100, capacity)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    {pool.labels.slice(0, 4).map((l) => (
                      <Badge key={l} variant="outline" className="text-[11px]">
                        {l}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {pluralize(pool.minRunners, 'min runner')} · created {timeAgo(pool.createdAt)}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {wid ? (
        <CreateRunnerPoolDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
