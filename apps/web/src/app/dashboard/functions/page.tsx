'use client';

import Link from 'next/link';
import { Activity, FunctionSquare, Plus, Timer } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceFunctions, useAutoCreate } from '@/lib/hooks';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { CreateFunctionDialog } from '@/components/dashboard/create-function-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { RuntimeBadge, runtimeLabel } from '@/components/dashboard/engine-badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb, timeAgo } from '@/lib/format';

export default function FunctionsPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useWorkspaceFunctions(wid);
  const [createOpen, setCreateOpen] = useAutoCreate();

  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'function.status') mutate();
    },
  });

  const functions = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Functions"
        description="Serverless functions that scale to zero and run on your nodes."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New function
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load functions." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : functions.length === 0 ? (
        <EmptyIllustration
          icon={FunctionSquare}
          title="No functions yet"
          description="Deploy a function from inline code or a repo. Invoke it over HTTP, watch latency in real time, and let it scale to zero when idle."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create function
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {functions.map((fn) => (
            <Link key={fn.id} href={`/dashboard/functions/${fn.id}`}>
              <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <RuntimeBadge runtime={fn.runtime} size={36} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{fn.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {runtimeLabel(fn.runtime)} · {fn.projectName}
                      </p>
                    </div>
                  </div>
                  <StatusBadge kind="function" status={fn.status} />
                </div>
                <p className="mt-3 truncate font-mono text-xs text-muted-foreground">{fn.handler}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{formatMb(fn.memoryMb)}</Badge>
                  <Badge variant="outline" className="gap-1">
                    <Timer className="h-3 w-3" /> {fn.timeoutMs / 1000}s
                  </Badge>
                  <Badge variant="default" className="gap-1">
                    <Activity className="h-3 w-3" /> {fn.invocations24h} / 24h
                  </Badge>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">Created {timeAgo(fn.createdAt)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {wid ? (
        <CreateFunctionDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
