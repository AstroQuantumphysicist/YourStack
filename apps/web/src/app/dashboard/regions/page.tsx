'use client';

import useSWR from 'swr';
import { Map, Server, Wifi } from 'lucide-react';
import { useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

function latencyTone(ms: number | null): { label: string; className: string } {
  if (ms == null) return { label: '—', className: 'text-muted-foreground' };
  if (ms < 40) return { label: `${ms} ms`, className: 'text-success' };
  if (ms < 120) return { label: `${ms} ms`, className: 'text-warning' };
  return { label: `${ms} ms`, className: 'text-danger' };
}

export default function RegionsPage() {
  const { workspace } = useSession();
  const { data, error, isLoading, mutate } = useSWR(
    workspace ? ['regions'] : null,
    () => api.regions(),
  );

  const regions = data?.regions ?? [];
  const totalNodes = regions.reduce((sum, r) => sum + (r.nodeCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regions"
        description="Where your capacity lives. Place databases, buckets and functions close to your users."
      />

      {error ? (
        <ErrorState message="Could not load regions." onRetry={() => mutate()} />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : regions.length === 0 ? (
        <EmptyIllustration
          icon={Map}
          title="No regions yet"
          description="Regions appear as you tag nodes with a location. Join nodes and assign them a region to spread your workloads."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Map className="h-4 w-4 text-primary" /> {pluralize(regions.length, 'region')}
            </span>
            <span className="flex items-center gap-1.5">
              <Server className="h-4 w-4 text-primary" /> {pluralize(totalNodes, 'node')} online
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {regions.map((r) => {
              const lat = latencyTone(r.latencyMs ?? null);
              return (
                <Card key={r.slug} className="p-5 transition-colors hover:border-primary/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl leading-none" aria-hidden>
                        {r.flag ?? '🌐'}
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.country ?? r.slug}
                        </p>
                      </div>
                    </div>
                    <Badge variant={r.nodeCount > 0 ? 'success' : 'default'}>
                      {r.nodeCount > 0 ? 'active' : 'empty'}
                    </Badge>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Nodes</p>
                      <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
                        {r.nodeCount}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                        <Wifi className="h-3.5 w-3.5" /> Latency
                      </p>
                      <p className={cn('mt-0.5 text-2xl font-semibold tabular-nums tracking-tight', lat.className)}>
                        {lat.label}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 font-mono text-[11px] uppercase tracking-wide text-muted-foreground/70">
                    {r.slug}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
