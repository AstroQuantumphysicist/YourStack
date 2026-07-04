'use client';

import Link from 'next/link';
import { Globe, HardDrive, Lock, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceBuckets, useAutoCreate } from '@/lib/hooks';
import { useSSE } from '@/lib/use-sse';
import { PageHeader } from '@/components/page-header';
import { CreateBucketDialog } from '@/components/dashboard/create-bucket-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { UsageBar } from '@/components/dashboard/usage-bar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb, pluralize } from '@/lib/format';

export default function StoragePage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useWorkspaceBuckets(wid);
  const [createOpen, setCreateOpen] = useAutoCreate();

  useSSE(wid ? `workspace:${wid}` : null, {
    onEvent: (msg) => {
      if (msg.type === 'bucket.status') mutate();
    },
  });

  const buckets = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage"
        description="S3-compatible object storage buckets running on your own capacity."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New bucket
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load buckets." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : buckets.length === 0 ? (
        <EmptyIllustration
          icon={HardDrive}
          title="No buckets yet"
          description="Create an S3-compatible bucket for assets, uploads and backups. Get an endpoint and access keys you can drop into any S3 client."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create bucket
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {buckets.map((b) => (
            <Link key={b.id} href={`/dashboard/storage/${b.id}`}>
              <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
                      <HardDrive className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{b.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{b.projectName}</p>
                    </div>
                  </div>
                  <StatusBadge kind="bucket" status={b.status} />
                </div>

                <div className="mt-4">
                  <UsageBar label="Usage" used={b.usedMb} total={b.quotaMb} format={formatMb} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant={b.isPublic ? 'info' : 'default'} className="gap-1">
                    {b.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {b.isPublic ? 'Public' : 'Private'}
                  </Badge>
                  <Badge variant="outline">{pluralize(b.objectCount, 'object')}</Badge>
                  {b.region ? <Badge variant="default">{b.region}</Badge> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {wid ? (
        <CreateBucketDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
