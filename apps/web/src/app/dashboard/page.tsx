'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  Activity,
  Boxes,
  CheckCircle2,
  Rocket,
  Server,
  Signal,
  TrendingUp,
} from 'lucide-react';
import type { AuditLogDTO, WorkspaceStatsDTO } from '@noderail/shared';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';

export default function OverviewPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;

  const stats = useSWR<{ stats: WorkspaceStatsDTO }>(wid ? `/workspaces/${wid}/stats` : null);
  const audit = useSWR<{ logs: AuditLogDTO[] }>(wid ? `/workspaces/${wid}/audit?limit=12` : null);

  const s = stats.data?.stats;
  const loading = stats.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={workspace ? workspace.name : 'Overview'}
        description="A live snapshot of your workspace — capacity, apps, and recent activity."
        actions={
          <Link href="/dashboard/apps">
            <Button>
              <Boxes className="h-4 w-4" /> New app
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Apps" value={s?.apps ?? 0} icon={Boxes} loading={loading} />
        <StatCard
          label="Running apps"
          value={s?.runningApps ?? 0}
          icon={CheckCircle2}
          accent="success"
          loading={loading}
        />
        <StatCard label="Nodes" value={s?.nodes ?? 0} icon={Server} loading={loading} />
        <StatCard
          label="Online nodes"
          value={s?.onlineNodes ?? 0}
          icon={Signal}
          accent="success"
          loading={loading}
          hint={s ? `${s.onlineNodes} of ${s.nodes} reachable` : undefined}
        />
        <StatCard
          label="Deployments"
          value={s?.deployments ?? 0}
          icon={Rocket}
          accent="info"
          loading={loading}
        />
        <StatCard
          label="Deployments today"
          value={s?.deploymentsToday ?? 0}
          icon={TrendingUp}
          accent="primary"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Recent activity
            </CardTitle>
            <Link
              href="/dashboard/settings"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Signal className="h-4 w-4 text-primary" /> Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <HealthRow
              label="Node fleet"
              ok={(s?.onlineNodes ?? 0) === (s?.nodes ?? 0) && (s?.nodes ?? 0) > 0}
              detail={s ? `${s.onlineNodes}/${s.nodes} online` : '—'}
              empty={(s?.nodes ?? 0) === 0}
              emptyText="No nodes joined"
            />
            <HealthRow
              label="Applications"
              ok={(s?.runningApps ?? 0) > 0}
              detail={s ? `${s.runningApps}/${s.apps} running` : '—'}
              empty={(s?.apps ?? 0) === 0}
              emptyText="No apps yet"
            />
            <div className="rounded-xl border border-border bg-surface-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                Get started by{' '}
                <Link href="/dashboard/nodes" className="text-primary hover:underline">
                  joining a node
                </Link>{' '}
                and{' '}
                <Link href="/dashboard/apps" className="text-primary hover:underline">
                  creating an app
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HealthRow({
  label,
  ok,
  detail,
  empty,
  emptyText,
}: {
  label: string;
  ok: boolean;
  detail: string;
  empty?: boolean;
  emptyText?: string;
}) {
  const color = empty ? 'bg-muted-foreground/50' : ok ? 'bg-success' : 'bg-warning';
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground">{empty ? emptyText : detail}</span>
    </div>
  );
}
