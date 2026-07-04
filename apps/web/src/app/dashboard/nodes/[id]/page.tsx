'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  Boxes,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { NodeDTO } from '@yourstack/shared';
import { api, ApiError, type HeartbeatPoint, type NodeAppSummary } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sparkline } from '@/components/ui/sparkline';
import { UsageBar } from '@/components/dashboard/usage-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { MetricsPanel } from '@/components/metrics/metrics-panel';
import { formatMb, timeAgo } from '@/lib/format';

export default function NodeDetailPage() {
  const params = useParams<{ id: string }>();
  const nodeId = params.id;
  const router = useRouter();
  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR<{ node: NodeDTO }>(`/nodes/${nodeId}`);
  const beats = useSWR<{ heartbeats: HeartbeatPoint[] }>(`/nodes/${nodeId}/heartbeats`);
  const apps = useSWR<{ apps: NodeAppSummary[] }>(`/nodes/${nodeId}/apps`);

  const [busy, setBusy] = useState<string | null>(null);

  useSSE(`node:${nodeId}`, {
    onEvent: (msg) => {
      if (msg.type === 'node.heartbeat' || msg.type === 'node.status') {
        mutate();
        beats.mutate();
      }
    },
  });

  const node = data?.node;
  const history = beats.data?.heartbeats ?? [];
  const cpuSeries = history.map((h) => h.cpuUsagePercent ?? 0);
  const memSeries = history.map((h) => h.memoryUsedMb ?? 0);

  const drain = async () => {
    if (!confirm('Drain this node? Running apps stay up but no new apps will be scheduled here.')) return;
    setBusy('drain');
    try {
      await api.drainNode(nodeId);
      toast.success('Node draining');
      mutate();
    } catch (err) {
      toast.error('Could not drain node', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm('Remove this node from the workspace? Its apps will be unassigned.')) return;
    setBusy('remove');
    try {
      await api.removeNode(nodeId);
      toast.success('Node removed');
      router.push('/dashboard/nodes');
    } catch (err) {
      toast.error('Could not remove node', err instanceof ApiError ? err.message : undefined);
      setBusy(null);
    }
  };

  if (error && !node) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message="Could not load node." onRetry={() => mutate()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isLoading || !node ? <Skeleton className="h-7 w-40" /> : node.name}
            {node ? <StatusBadge kind="node" status={node.status} /> : null}
          </span>
        }
        description={
          node
            ? `${node.publicIp ?? 'no public IP'} · agent ${node.agentVersion ?? '—'} · ${node.os ?? '—'}/${node.arch ?? '—'}`
            : undefined
        }
        actions={
          node ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" loading={busy === 'drain'} onClick={drain}>
                Drain
              </Button>
              <Button variant="danger" size="sm" loading={busy === 'remove'} onClick={remove}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          ) : undefined
        }
      />

      {!node ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <ResourceCard
              title="CPU"
              icon={Cpu}
              series={cpuSeries}
              footer={
                <UsageBar label="Usage" used={node.cpuUsagePercent} total={100} format={(n) => `${Math.round(n)}%`} />
              }
              maxHint={`${node.cpuCores ?? '—'} cores`}
            />
            <ResourceCard
              title="Memory"
              icon={MemoryStick}
              series={memSeries}
              footer={
                <UsageBar
                  label="Usage"
                  used={node.memoryUsedMb}
                  total={node.memoryTotalMb}
                  format={formatMb}
                />
              }
              maxHint={formatMb(node.memoryTotalMb)}
            />
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-primary" /> Disk
                </CardTitle>
                <span className="text-xs text-muted-foreground">{formatMb(node.diskTotalMb)}</span>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageBar
                  label="Usage"
                  used={node.diskUsedMb}
                  total={node.diskTotalMb}
                  format={formatMb}
                />
                <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
                  <Meta label="Docker" value={node.dockerVersion ?? '—'} />
                  <Meta label="Running apps" value={String(node.runningAppCount)} />
                  <Meta label="Heartbeat" value={timeAgo(node.lastHeartbeatAt)} />
                  <Meta label="Joined" value={timeAgo(node.createdAt)} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <LabelsCard node={node} onChange={() => mutate()} />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-primary" /> Running apps
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(apps.data?.apps ?? []).length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No apps scheduled on this node.</p>
                ) : (
                  <div className="space-y-2">
                    {apps.data!.apps.map((a) => (
                      <Link
                        key={a.id}
                        href={`/dashboard/apps/${a.id}`}
                        className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
                      >
                        <span className="truncate font-medium text-foreground">{a.name}</span>
                        <StatusBadge kind="app" status={a.status} />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" /> Live worker load
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsPanel scope="node" targetId={nodeId} height={160} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ResourceCard({
  title,
  icon: Icon,
  series,
  footer,
  maxHint,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  series: number[];
  footer: React.ReactNode;
  maxHint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
        <span className="text-xs text-muted-foreground">{maxHint}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <Sparkline data={series} height={56} max={title === 'CPU' ? 100 : undefined} />
        {footer}
      </CardContent>
    </Card>
  );
}

function LabelsCard({ node, onChange }: { node: NodeDTO; onChange: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    try {
      await api.setNodeLabel(node.id, key.trim(), value.trim());
      setKey('');
      setValue('');
      onChange();
    } catch (err) {
      toast.error('Could not add label', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (k: string) => {
    try {
      await api.removeNodeLabel(node.id, k);
      onChange();
    } catch (err) {
      toast.error('Could not remove label', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" /> Labels
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {node.labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No labels. Use labels to target apps at specific nodes.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {node.labels.map((l) => (
              <Badge key={l.key} variant="outline" className="gap-1.5 pr-1">
                <span className="font-mono text-xs">
                  {l.key}={l.value}
                </span>
                <button
                  onClick={() => remove(l.key)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-danger"
                  aria-label={`Remove ${l.key}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <form onSubmit={add} className="flex items-center gap-2">
          <Input
            placeholder="key"
            className="font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Input
            placeholder="value"
            className="font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" size="icon" loading={saving} disabled={!key.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm text-foreground">{value}</p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/nodes"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All nodes
    </Link>
  );
}
