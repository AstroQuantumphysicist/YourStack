'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Plus, Server } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceApps } from '@/lib/hooks';
import { PageHeader } from '@/components/page-header';
import { CreateAppDialog } from '@/components/dashboard/create-app-dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';

export default function AppsPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useWorkspaceApps(wid);
  const [createOpen, setCreateOpen] = useState(false);

  const apps = data?.apps ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apps"
        description="Deployable services running on your nodes."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New app
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load apps." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={5} />
      ) : apps.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No apps yet"
          description="Create your first app to deploy code onto a node. You can attach a Git repo or a Dockerfile."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create app
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Link key={app.id} href={`/dashboard/apps/${app.id}`}>
              <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{app.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.projectName} / {app.slug}
                    </p>
                  </div>
                  <StatusBadge kind="app" status={app.status} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {app.framework ? (
                    <Badge variant="outline" className="capitalize">
                      {app.framework}
                    </Badge>
                  ) : null}
                  <Badge variant="default">:{app.port}</Badge>
                  <Badge variant={app.nodeId ? 'info' : 'warning'} className="gap-1">
                    <Server className="h-3 w-3" />
                    {app.nodeId ? 'assigned' : 'no node'}
                  </Badge>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Updated {timeAgo(app.updatedAt)}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {wid ? (
        <CreateAppDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
