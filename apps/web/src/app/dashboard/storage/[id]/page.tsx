'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, Boxes, Globe, KeyRound, Lock, Trash2 } from 'lucide-react';
import type { BucketDTO } from '@yourstack/shared';
import { api, ApiError, type BucketCredentials } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { RevealField } from '@/components/dashboard/reveal-field';
import { UsageBar } from '@/components/dashboard/usage-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb, formatDateFull, pluralize } from '@/lib/format';

export default function BucketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ bucket: BucketDTO }>(`/buckets/${id}`);
  const bucket = data?.bucket;

  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<BucketCredentials | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);

  useSSE(`bucket:${id}`, {
    onEvent: (msg) => {
      if (msg.type === 'bucket.status') mutate();
    },
  });

  const revealCreds = async () => {
    setLoadingCreds(true);
    try {
      const { credentials } = await api.bucketCredentials(id);
      setCreds(credentials);
    } catch (err) {
      toast.error('Could not load credentials', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoadingCreds(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete bucket "${bucket?.name}"? All objects will be lost.`)) return;
    setBusy(true);
    try {
      await api.deleteBucket(id);
      toast.success('Bucket deleted');
      router.push('/dashboard/storage');
    } catch (err) {
      toast.error('Could not delete bucket', err instanceof ApiError ? err.message : undefined);
      setBusy(false);
    }
  };

  if (error && !bucket) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => mutate()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isLoading || !bucket ? <Skeleton className="h-7 w-40" /> : bucket.name}
            {bucket ? <StatusBadge kind="bucket" status={bucket.status} /> : null}
          </span>
        }
        description={bucket ? `${bucket.isPublic ? 'Public' : 'Private'} · ${bucket.region ?? 'no region'}` : undefined}
        actions={
          <Button size="sm" variant="danger" loading={busy} onClick={remove}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> S3 credentials
            </CardTitle>
            {!creds ? (
              <Button size="sm" variant="secondary" loading={loadingCreds} onClick={revealCreds}>
                Reveal keys
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <RevealField label="Endpoint" value={bucket?.endpoint} />
            {creds ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <RevealField label="Region" value={creds.region} mono={false} />
                  <RevealField label="Access key" value={creds.accessKey} secret />
                </div>
                <RevealField label="Secret key" value={creds.secretKey} secret />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-3 py-3 text-xs text-muted-foreground">
                Reveal the access key and secret to configure the AWS SDK, `aws s3`, or any
                S3-compatible client against this endpoint.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageBar
              label="Storage"
              used={bucket?.usedMb ?? 0}
              total={bucket?.quotaMb ?? 0}
              format={formatMb}
            />
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Boxes className="h-4 w-4" /> Objects
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {bucket ? pluralize(bucket.objectCount, 'object') : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Visibility</span>
              <Badge variant={bucket?.isPublic ? 'info' : 'default'} className="gap-1">
                {bucket?.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {bucket?.isPublic ? 'Public' : 'Private'}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Created</span>
              <span className="font-medium text-foreground">
                {bucket ? formatDateFull(bucket.createdAt) : '—'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/storage"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All buckets
    </Link>
  );
}
