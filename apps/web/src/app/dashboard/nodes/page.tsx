'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Cpu, MemoryStick, Plus, Server } from 'lucide-react';
import type { NodeDTO } from '@noderail/shared';
import { useSession } from '@/lib/session';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { JoinNodeDialog } from '@/components/dashboard/join-node-dialog';
import { UsageBar } from '@/components/dashboard/usage-bar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { formatMb, timeAgo } from '@/lib/format';

export default function NodesPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useSWR<{ nodes: NodeDTO[] }>(
    wid ? `/workspaces/${wid}/nodes` : null,
  );
  const [joinOpen, setJoinOpen] = useState(false);

  // Live heartbeat/status refresh for the fleet.
  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'node.status' || msg.type === 'node.heartbeat') mutate();
    },
  });

  const nodes = data?.nodes ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nodes"
        description="Your own servers, turned into managed capacity."
        actions={
          <Button onClick={() => setJoinOpen(true)}>
            <Plus className="h-4 w-4" /> Join a node
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load nodes." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : nodes.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No nodes joined"
          description="Attach a server to this workspace. Run one command and it becomes managed capacity for your apps."
          action={
            <Button onClick={() => setJoinOpen(true)}>
              <Plus className="h-4 w-4" /> Join a node
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => (
            <Link key={node.id} href={`/dashboard/nodes/${node.id}`}>
              <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{node.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {node.region ?? 'no region'} · {node.os ?? '—'}/{node.arch ?? '—'}
                    </p>
                  </div>
                  <StatusBadge kind="node" status={node.status} />
                </div>

                <div className="mt-4 space-y-2.5">
                  <UsageBar
                    label="CPU"
                    used={node.cpuUsagePercent}
                    total={100}
                    format={(n) => `${Math.round(n)}%`}
                  />
                  <UsageBar
                    label="Memory"
                    used={node.memoryUsedMb}
                    total={node.memoryTotalMb}
                    format={formatMb}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="gap-1">
                    <Cpu className="h-3 w-3" /> {node.cpuCores ?? '—'} cores
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <MemoryStick className="h-3 w-3" /> {formatMb(node.memoryTotalMb)}
                  </Badge>
                  <Badge variant="default">{node.runningAppCount} apps</Badge>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Heartbeat {timeAgo(node.lastHeartbeatAt)}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {wid ? (
        <JoinNodeDialog wid={wid} open={joinOpen} onClose={() => setJoinOpen(false)} />
      ) : null}
    </div>
  );
}
