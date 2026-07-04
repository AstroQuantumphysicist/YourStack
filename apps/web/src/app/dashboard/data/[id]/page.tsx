'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  DatabaseBackup,
  KeyRound,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import type { DatabaseDTO } from '@yourstack/shared';
import { DatabaseStatus } from '@yourstack/shared';
import { api, ApiError, type DatabaseCredentials } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { EngineBadge, engineLabel } from '@/components/dashboard/engine-badge';
import { RevealField } from '@/components/dashboard/reveal-field';
import { MetricsPanel } from '@/components/metrics/metrics-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb, formatDateFull } from '@/lib/format';

export default function DatabaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ database: DatabaseDTO }>(`/databases/${id}`);
  const db = data?.database;

  const [busy, setBusy] = useState<string | null>(null);
  const [creds, setCreds] = useState<DatabaseCredentials | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);

  useSSE(`database:${id}`, {
    onEvent: (msg) => {
      if (msg.type === 'database.status') mutate();
    },
  });

  const action = useCallback(
    async (kind: 'backup' | 'stop' | 'start') => {
      setBusy(kind);
      try {
        if (kind === 'backup') await api.backupDatabase(id);
        else if (kind === 'stop') await api.stopDatabase(id);
        else await api.startDatabase(id);
        toast.success(`Database ${kind === 'backup' ? 'backup started' : `${kind} requested`}`);
        mutate();
      } catch (err) {
        toast.error(`Could not ${kind} database`, err instanceof ApiError ? err.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [id, toast, mutate],
  );

  const revealCreds = async () => {
    setLoadingCreds(true);
    try {
      const { credentials } = await api.databaseCredentials(id);
      setCreds(credentials);
    } catch (err) {
      toast.error('Could not load credentials', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoadingCreds(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete database "${db?.name}"? This destroys its data and cannot be undone.`)) return;
    setBusy('delete');
    try {
      await api.deleteDatabase(id);
      toast.success('Database deleted');
      router.push('/dashboard/data');
    } catch (err) {
      toast.error('Could not delete database', err instanceof ApiError ? err.message : undefined);
      setBusy(null);
    }
  };

  if (error && !db) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => mutate()} />
      </div>
    );
  }

  const stopped = db?.status === DatabaseStatus.STOPPED;

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {db ? <EngineBadge engine={db.engine} size={32} /> : null}
            {isLoading || !db ? <Skeleton className="h-7 w-40" /> : db.name}
            {db ? <StatusBadge kind="database" status={db.status} /> : null}
          </span>
        }
        description={db ? `${engineLabel(db.engine)} ${db.version} · ${db.region ?? 'no region'}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" loading={busy === 'backup'} disabled={!!busy || stopped} onClick={() => action('backup')}>
              <DatabaseBackup className="h-4 w-4" /> Backup
            </Button>
            {stopped ? (
              <Button size="sm" loading={busy === 'start'} disabled={!!busy} onClick={() => action('start')}>
                <Play className="h-4 w-4" /> Start
              </Button>
            ) : (
              <Button size="sm" variant="outline" loading={busy === 'stop'} disabled={!!busy} onClick={() => action('stop')}>
                <Square className="h-4 w-4" /> Stop
              </Button>
            )}
            <Button size="sm" variant="danger" loading={busy === 'delete'} disabled={!!busy} onClick={remove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> Connection
            </CardTitle>
            {!creds ? (
              <Button size="sm" variant="secondary" loading={loadingCreds} onClick={revealCreds}>
                Reveal credentials
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <RevealField label="Host" value={db?.host} />
              <RevealField label="Port" value={db?.port != null ? String(db.port) : null} mono />
            </div>
            {creds ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <RevealField label="Username" value={creds.username} />
                  <RevealField label="Password" value={creds.password} secret />
                </div>
                <RevealField label="Connection string" value={creds.connectionString} secret />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-3 py-3 text-xs text-muted-foreground">
                Credentials are shown on demand and never logged. Reveal them to copy the username,
                password and connection string.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Specs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Spec label="Storage" value={formatMb(db?.storageMb)} />
            <Spec label="Memory" value={formatMb(db?.memoryMb)} />
            <Spec label="vCPU" value={db ? `${db.cpu}` : '—'} />
            <Spec label="Project" value={db?.projectId ? db.projectId.slice(0, 10) : '—'} />
            <Spec label="Created" value={db ? formatDateFull(db.createdAt) : '—'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Observability</CardTitle>
        </CardHeader>
        <CardContent>
          <MetricsPanel scope="database" targetId={id} height={160} />
        </CardContent>
      </Card>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/data"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All databases
    </Link>
  );
}
