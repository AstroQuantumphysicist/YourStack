'use client';

import Link from 'next/link';
import { Database, HardDrive, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceDatabases, useAutoCreate } from '@/lib/hooks';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { CreateDatabaseDialog } from '@/components/dashboard/create-database-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { EngineBadge, engineLabel } from '@/components/dashboard/engine-badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb, timeAgo } from '@/lib/format';

export default function DatabasesPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useWorkspaceDatabases(wid);
  const [createOpen, setCreateOpen] = useAutoCreate();

  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'database.status') mutate();
    },
  });

  const databases = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Databases"
        description="Managed Postgres, MySQL, Redis and MongoDB — provisioned on your own nodes."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New database
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load databases." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : databases.length === 0 ? (
        <EmptyIllustration
          icon={Database}
          title="No databases yet"
          description="Spin up a managed database in seconds. Pick an engine, size it, and we provision it on your capacity with credentials ready to copy."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create database
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {databases.map((db) => (
            <Link key={db.id} href={`/dashboard/data/${db.id}`}>
              <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <EngineBadge engine={db.engine} size={36} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{db.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {engineLabel(db.engine)} {db.version} · {db.projectName}
                      </p>
                    </div>
                  </div>
                  <StatusBadge kind="database" status={db.status} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="gap-1">
                    <HardDrive className="h-3 w-3" /> {formatMb(db.storageMb)}
                  </Badge>
                  <Badge variant="outline">{db.cpu} vCPU</Badge>
                  <Badge variant="outline">{formatMb(db.memoryMb)}</Badge>
                  {db.region ? <Badge variant="default">{db.region}</Badge> : null}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">Created {timeAgo(db.createdAt)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {wid ? (
        <CreateDatabaseDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
