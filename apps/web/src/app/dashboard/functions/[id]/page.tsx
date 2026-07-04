'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, Play, Timer, Trash2, Zap } from 'lucide-react';
import type { FunctionDTO } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { RuntimeBadge, runtimeLabel } from '@/components/dashboard/engine-badge';
import { RevealField } from '@/components/dashboard/reveal-field';
import { MetricsPanel } from '@/components/metrics/metrics-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatMb, timeAgo } from '@/lib/format';
import type { FunctionInvocation } from '@/lib/api';

export default function FunctionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ function: FunctionDTO }>(`/functions/${id}`);
  const fn = data?.function;

  const invocations = useSWR<{ invocations: FunctionInvocation[] }>(`/functions/${id}/invocations`);

  const [payload, setPayload] = useState('{\n  "name": "world"\n}');
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<{ commandId: string; at: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useSSE(`function:${id}`, {
    onEvent: (msg) => {
      if (msg.type === 'function.status') mutate();
      if (msg.type === 'function.invocation') invocations.mutate();
    },
  });

  const invoke = async () => {
    let parsed: unknown;
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      toast.error('Invalid JSON', 'Fix the payload before invoking.');
      return;
    }
    setInvoking(true);
    try {
      const res = await api.invokeFunction(id, parsed);
      setResult({ commandId: res.commandId, at: new Date().toISOString() });
      toast.success('Invocation queued', `Command ${res.commandId.slice(0, 8)}`);
      setTimeout(() => invocations.mutate(), 800);
    } catch (err) {
      toast.error('Invocation failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setInvoking(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete function "${fn?.name}"?`)) return;
    setDeleting(true);
    try {
      await api.deleteFunction(id);
      toast.success('Function deleted');
      router.push('/dashboard/functions');
    } catch (err) {
      toast.error('Could not delete function', err instanceof ApiError ? err.message : undefined);
      setDeleting(false);
    }
  };

  if (error && !fn) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => mutate()} />
      </div>
    );
  }

  const recent = invocations.data?.invocations ?? [];

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {fn ? <RuntimeBadge runtime={fn.runtime} size={32} /> : null}
            {isLoading || !fn ? <Skeleton className="h-7 w-40" /> : fn.name}
            {fn ? <StatusBadge kind="function" status={fn.status} /> : null}
          </span>
        }
        description={fn ? `${runtimeLabel(fn.runtime)} · ${fn.handler}` : undefined}
        actions={
          <Button size="sm" variant="danger" loading={deleting} onClick={remove}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Invoke
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <RevealField label="Invoke URL" value={fn?.url} />
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Payload (JSON)
              </p>
              <Textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={6}
                className="font-mono text-[13px]"
                spellCheck={false}
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" loading={invoking} onClick={invoke} disabled={fn?.status === 'deploying'}>
                <Play className="h-4 w-4" /> Send invocation
              </Button>
            </div>
            {result ? (
              <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-sm">
                <p className="font-medium text-success">Invocation accepted</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  command {result.commandId} · {timeAgo(result.at)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The result will appear in recent invocations below once the node reports back.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Runtime" value={fn ? runtimeLabel(fn.runtime) : '—'} />
            <Row label="Memory" value={formatMb(fn?.memoryMb)} />
            <Row
              label="Timeout"
              value={fn ? `${fn.timeoutMs / 1000}s` : '—'}
              icon={<Timer className="h-3.5 w-3.5" />}
            />
            <Row label="Min instances" value={fn ? String(fn.minInstances) : '—'} />
            <Row label="Region" value={fn?.region ?? 'auto'} />
            <Row label="24h invocations" value={fn ? String(fn.invocations24h) : '—'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent invocations</CardTitle>
        </CardHeader>
        <CardContent>
          {invocations.isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No invocations yet. Send one above to see it here.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {recent.slice(0, 12).map((iv) => (
                <div key={iv.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge
                      variant={
                        iv.status === 'succeeded' ? 'success' : iv.status === 'failed' ? 'danger' : 'default'
                      }
                    >
                      {iv.statusCode ?? iv.status}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {iv.id.slice(0, 8)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {iv.durationMs != null ? (
                      <span className="tabular-nums text-foreground">{Math.round(iv.durationMs)} ms</span>
                    ) : null}
                    <span>{timeAgo(iv.createdAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latency & throughput</CardTitle>
        </CardHeader>
        <CardContent>
          <MetricsPanel scope="function" targetId={id} kinds={['latency_ms', 'rps']} height={170} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/functions"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All functions
    </Link>
  );
}
