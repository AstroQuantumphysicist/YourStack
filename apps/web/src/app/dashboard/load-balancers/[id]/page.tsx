'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  Boxes,
  Globe,
  Network,
  RefreshCw,
  Target,
  Trash2,
} from 'lucide-react';
import type { LoadBalancerDTO } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';

const ALGO_LABELS: Record<string, string> = {
  round_robin: 'Round robin',
  least_conn: 'Least connections',
  ip_hash: 'IP hash',
};

export default function LoadBalancerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR<{ loadBalancer: LoadBalancerDTO }>(
    `/load-balancers/${id}`,
  );
  const lb = data?.loadBalancer;
  const [reconciling, setReconciling] = useState(false);

  const reconcile = async () => {
    setReconciling(true);
    try {
      await api.reconcileLoadBalancer(id);
      toast.success('Reconciling', 'Re-syncing backends and config.');
      mutate();
    } catch (err) {
      toast.error('Could not reconcile', err instanceof ApiError ? err.message : undefined);
    } finally {
      setReconciling(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this load balancer? Traffic will stop being routed through it.')) return;
    try {
      await api.deleteLoadBalancer(id);
      toast.success('Load balancer deleted');
      router.push('/dashboard/load-balancers');
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error && !lb) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message="Could not load load balancer." onRetry={() => mutate()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isLoading || !lb ? <Skeleton className="h-7 w-40" /> : lb.name}
            {lb ? <StatusBadge kind="loadBalancer" status={lb.status} /> : null}
          </span>
        }
        description={
          lb
            ? `Listening on port ${lb.listenPort} · ${ALGO_LABELS[lb.algorithm] ?? lb.algorithm}`
            : undefined
        }
        actions={
          lb ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" loading={reconciling} onClick={reconcile}>
                <RefreshCw className="h-4 w-4" /> Reconcile
              </Button>
              <Button variant="danger" size="icon" onClick={remove} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : undefined
        }
      />

      {!lb ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Listen port" value={`:${lb.listenPort}`} icon={Network} />
            <Stat label="Algorithm" value={ALGO_LABELS[lb.algorithm] ?? lb.algorithm} icon={Boxes} />
            <Stat label="Targets" value={String(lb.targets.length)} icon={Target} />
            <Stat
              label="Sessions"
              value={lb.sticky ? 'Sticky' : 'Stateless'}
              icon={Network}
            />
          </div>

          {lb.domain ? (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Globe className="h-5 w-5 text-primary" />
                <span className="font-medium text-foreground">{lb.domain}</span>
                {lb.autoHttps ? (
                  <Badge variant="success">Auto HTTPS</Badge>
                ) : (
                  <Badge variant="outline">HTTP only</Badge>
                )}
                {lb.region ? <Badge variant="default">{lb.region}</Badge> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Backend targets
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lb.targets.length === 0 ? (
                <EmptyState
                  icon={Target}
                  title="No targets"
                  description="This load balancer has no backends yet. Reconcile after attaching apps."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Address</TH>
                      <TH>Weight</TH>
                      <TH>Source</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lb.targets.map((t, i) => (
                      <TR key={`${t.address}-${i}`}>
                        <TD className="font-mono text-xs text-foreground">{t.address}</TD>
                        <TD className="text-sm text-muted-foreground">{t.weight}</TD>
                        <TD>
                          {t.appId ? (
                            <Badge variant="primary" className="gap-1">
                              <Boxes className="h-3 w-3" /> App
                            </Badge>
                          ) : (
                            <Badge variant="outline">Manual</Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1.5 text-lg font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/load-balancers"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All load balancers
    </Link>
  );
}
