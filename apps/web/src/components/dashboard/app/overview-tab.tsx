'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Cpu, GitBranch, MemoryStick, Network, Server } from 'lucide-react';
import type { AppDTO, DeploymentDTO, NodeDTO } from '@noderail/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatMb, timeAgo, shortId } from '@/lib/format';

export function OverviewTab({ app }: { app: AppDTO }) {
  const deployments = useSWR<{ deployments: DeploymentDTO[] }>(`/apps/${app.id}/deployments`);
  const node = useSWR<{ node: NodeDTO }>(app.nodeId ? `/nodes/${app.nodeId}` : null);

  const recent = (deployments.data?.deployments ?? []).slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Fact label="Framework" value={app.framework ?? '—'} className="capitalize" />
          <Fact label="Port" value={`:${app.port}`} />
          <Fact label="Strategy" value={app.deploymentStrategy.replace('_', ' ')} className="capitalize" />
          <Fact label="Branch" value={app.branch} icon={GitBranch} />
          <Fact label="Healthcheck" value={app.healthcheckPath} />
          <Fact label="Resources" value={`${app.cpu} vCPU · ${formatMb(app.memoryMb)}`} />
          <div className="col-span-2 sm:col-span-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Repository</p>
            <p className="mt-1 truncate text-sm text-foreground">
              {app.repoUrl ?? 'No repository connected'}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" /> Node
            </CardTitle>
          </CardHeader>
          <CardContent>
            {app.nodeId ? (
              node.data ? (
                <Link
                  href={`/dashboard/nodes/${app.nodeId}`}
                  className="block rounded-xl border border-border p-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{node.data.node.name}</span>
                    <StatusBadge kind="node" status={node.data.node.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3 w-3" /> {node.data.node.cpuCores ?? '—'} cores
                    </span>
                    <span className="flex items-center gap-1">
                      <MemoryStick className="h-3 w-3" />
                      {formatMb(node.data.node.memoryTotalMb)}
                    </span>
                  </div>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Loading node…</p>
              )
            ) : (
              <div className="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5 text-warning">
                  <Network className="h-4 w-4" /> No node assigned
                </span>
                <p className="mt-1 text-xs">
                  Assign an online node in Settings before deploying.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent deployments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deployments yet.</p>
            ) : (
              recent.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-foreground">v{d.version}</span>
                    <span className="text-xs text-muted-foreground">{shortId(d.commitSha ?? '')}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge kind="deployment" status={d.status} />
                    <span className="text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 flex items-center gap-1.5 text-sm text-foreground ${className ?? ''}`}>
        {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {value}
      </p>
    </div>
  );
}
