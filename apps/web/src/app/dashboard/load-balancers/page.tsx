'use client';

import Link from 'next/link';
import { Globe, Network, Plus, Target } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceLoadBalancers, useAutoCreate } from '@/lib/hooks';
import { PageHeader } from '@/components/page-header';
import { CreateLoadBalancerDialog } from '@/components/dashboard/create-load-balancer-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { pluralize } from '@/lib/format';

const ALGO_LABELS: Record<string, string> = {
  round_robin: 'Round robin',
  least_conn: 'Least conn',
  ip_hash: 'IP hash',
};

export default function LoadBalancersPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useWorkspaceLoadBalancers(wid);
  const [createOpen, setCreateOpen] = useAutoCreate();

  const lbs = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Load balancers"
        description="Spread traffic across app replicas and backends with health-aware routing."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New load balancer
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load load balancers." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : lbs.length === 0 ? (
        <EmptyIllustration
          icon={Network}
          title="No load balancers yet"
          description="Create a load balancer to distribute incoming requests across your app replicas or manual backends, with an optional domain and automatic HTTPS."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create load balancer
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lbs.map((lb) => (
            <Link key={lb.id} href={`/dashboard/load-balancers/${lb.id}`}>
              <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
                      <Network className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{lb.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{lb.projectName}</p>
                    </div>
                  </div>
                  <StatusBadge kind="loadBalancer" status={lb.status} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="font-mono">
                    :{lb.listenPort}
                  </Badge>
                  <Badge variant="default">{ALGO_LABELS[lb.algorithm] ?? lb.algorithm}</Badge>
                  <Badge variant="outline" className="gap-1">
                    <Target className="h-3 w-3" /> {pluralize(lb.targets.length, 'target')}
                  </Badge>
                </div>

                {lb.domain ? (
                  <div className="mt-3 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{lb.domain}</span>
                    {lb.autoHttps ? (
                      <Badge variant="success" className="ml-auto shrink-0">
                        HTTPS
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}

      {wid ? (
        <CreateLoadBalancerDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
