'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  Activity,
  Boxes,
  Container,
  Cpu,
  Database,
  FunctionSquare,
  HardDrive,
  Rocket,
  Server,
  TrendingUp,
} from 'lucide-react';
import type { AuditLogDTO, NodeDTO, WorkspaceStatsDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function OverviewPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;

  const stats = useSWR<{ stats: WorkspaceStatsDTO }>(wid ? `/workspaces/${wid}/stats` : null);
  const audit = useSWR<{ logs: AuditLogDTO[] }>(wid ? `/workspaces/${wid}/audit?limit=12` : null);
  const nodes = useSWR<{ nodes: NodeDTO[] }>(wid ? `/workspaces/${wid}/nodes` : null);

  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'node.heartbeat' || msg.type === 'node.status') nodes.mutate();
    },
  });

  const s = stats.data?.stats;
  const loading = stats.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={workspace ? workspace.name : 'Overview'}
        description="A live snapshot of your workspace — capacity, managed resources, and worker load."
        actions={
          <Link href="/dashboard/apps?new=1">
            <Button>
              <Boxes className="h-4 w-4" /> New app
            </Button>
          </Link>
        }
      />

      <OnboardingChecklist stats={s} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Apps" value={s?.apps ?? 0} icon={Boxes} loading={loading} hint={s ? `${s.runningApps} running` : undefined} />
        <StatCard
          label="Nodes"
          value={s?.nodes ?? 0}
          icon={Server}
          accent="success"
          loading={loading}
          hint={s ? `${s.onlineNodes} online` : undefined}
        />
        <StatCard label="Deployments" value={s?.deployments ?? 0} icon={Rocket} accent="info" loading={loading} />
        <StatCard
          label="Today"
          value={s?.deploymentsToday ?? 0}
          icon={TrendingUp}
          accent="primary"
          loading={loading}
          hint="deployments"
        />
        <StatCard label="Databases" value={s?.databases ?? 0} icon={Database} accent="info" loading={loading} />
        <StatCard label="Buckets" value={s?.buckets ?? 0} icon={HardDrive} accent="primary" loading={loading} />
        <StatCard label="Functions" value={s?.functions ?? 0} icon={FunctionSquare} accent="success" loading={loading} />
        <StatCard label="Runners" value={s?.runners ?? 0} icon={Container} accent="warning" loading={loading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <WorkerLoad nodes={nodes.data?.nodes} loading={nodes.isLoading} error={!!nodes.error} onRetry={() => nodes.mutate()} />

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Recent activity
            </CardTitle>
            <Link href="/dashboard/settings" className="text-xs text-muted-foreground hover:text-foreground">
              View audit log
            </Link>
          </CardHeader>
          <CardContent>
            {audit.error ? (
              <ErrorState message="Could not load activity." onRetry={() => audit.mutate()} />
            ) : audit.isLoading ? (
              <SkeletonRows rows={5} />
            ) : (
              <ActivityFeed logs={audit.data?.logs ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WorkerLoad({
  nodes,
  loading,
  error,
  onRetry,
}: {
  nodes: NodeDTO[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const top = (nodes ?? [])
    .slice()
    .sort((a, b) => (b.cpuUsagePercent ?? 0) - (a.cpuUsagePercent ?? 0))
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-primary" /> Worker load
        </CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-success" /> Live
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <ErrorState message="Could not load nodes." onRetry={onRetry} />
        ) : loading ? (
          <SkeletonRows rows={3} />
        ) : top.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            <p>No nodes joined yet.</p>
            <Link href="/dashboard/nodes" className="mt-1 inline-block text-primary hover:underline">
              Join a node
            </Link>
          </div>
        ) : (
          top.map((n) => {
            const cpu = Math.round(n.cpuUsagePercent ?? 0);
            const memPct =
              n.memoryTotalMb && n.memoryUsedMb != null
                ? Math.round((n.memoryUsedMb / n.memoryTotalMb) * 100)
                : 0;
            return (
              <Link
                key={n.id}
                href={`/dashboard/nodes/${n.id}`}
                className="block rounded-xl border border-border p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium text-foreground">{n.name}</span>
                  <Badge variant={n.status === 'online' ? 'success' : 'default'} className="shrink-0">
                    {n.status}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1.5">
                  <LoadBar label="CPU" pct={cpu} detail={`${cpu}%`} />
                  <LoadBar label="RAM" pct={memPct} detail={formatMb(n.memoryUsedMb)} />
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function LoadBar({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const color = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-primary';
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{detail}</span>
    </div>
  );
}
