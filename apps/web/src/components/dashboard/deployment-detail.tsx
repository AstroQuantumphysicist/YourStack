'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { GitCommitHorizontal } from 'lucide-react';
import { api, type DeploymentDetail as DeploymentDetailData, type DeploymentLogLine } from '@/lib/api';
import { useSSE, type SSEMessage } from '@/lib/use-sse';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PipelineTimeline } from '@/components/dashboard/pipeline-timeline';
import { LogViewer, type LogLine } from '@/components/dashboard/log-viewer';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatDateFull, shortId } from '@/lib/format';

function toLine(l: DeploymentLogLine): LogLine {
  return { id: l.id, message: l.message, severity: l.severity, stream: l.stream, timestamp: l.timestamp };
}

function fromEvent(data: unknown, stream: string): LogLine | null {
  if (data == null) return null;
  const obj = typeof data === 'object' ? (data as Record<string, unknown>) : { message: String(data) };
  return {
    id: `sse-${Math.random().toString(36).slice(2)}`,
    message: typeof obj.message === 'string' ? obj.message : JSON.stringify(obj),
    severity: typeof obj.severity === 'string' ? obj.severity : undefined,
    stream,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
  };
}

export function DeploymentDetail({ deploymentId }: { deploymentId: string }) {
  const { data, error, isLoading, mutate } = useSWR<DeploymentDetailData>(
    `/deployments/${deploymentId}`,
    () => api.deployment(deploymentId),
  );
  const logs = useSWR<{ logs: DeploymentLogLine[] }>(
    `/deployments/${deploymentId}/logs`,
    () => api.deploymentLogs(deploymentId),
  );
  const [liveLines, setLiveLines] = useState<LogLine[]>([]);

  useEffect(() => {
    setLiveLines([]);
  }, [deploymentId]);

  const onEvent = useCallback(
    (msg: SSEMessage) => {
      if (msg.type === 'log.build' || msg.type === 'log.runtime') {
        const line = fromEvent(msg.data, msg.type === 'log.build' ? 'build' : 'runtime');
        if (line) setLiveLines((prev) => [...prev.slice(-800), line]);
      } else if (msg.type === 'deployment.status') {
        mutate();
      }
    },
    [mutate],
  );

  const { status } = useSSE(`deployment:${deploymentId}`, { onEvent });

  if (error) return <ErrorState message="Could not load deployment." onRetry={() => mutate()} />;
  if (isLoading || !data) return <Skeleton className="h-96 w-full rounded-2xl" />;

  const { deployment, pipelineRun } = data;
  const lines = [...(logs.data?.logs ?? []).map(toLine), ...liveLines];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Deployment v{deployment.version}
              <StatusBadge kind="deployment" status={deployment.status} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Created {formatDateFull(deployment.createdAt)} · by {deployment.triggeredBy ?? '—'}
            </p>
          </div>
          <Link
            href={`/dashboard/apps/${deployment.appId}`}
            className="text-xs text-primary hover:underline"
          >
            View app
          </Link>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Meta label="Version" value={`v${deployment.version}`} />
          <Meta
            label="Commit"
            value={deployment.commitSha ? shortId(deployment.commitSha) : deployment.ref ?? '—'}
            icon
          />
          <Meta label="Image" value={deployment.imageTag ?? '—'} />
          <Meta label="Healthy" value={deployment.healthy == null ? '—' : deployment.healthy ? 'yes' : 'no'} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {pipelineRun ? (
              <PipelineTimeline run={pipelineRun} />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                No pipeline run recorded for this deployment.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-2 lg:col-span-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-medium text-foreground">Build &amp; deploy logs</span>
            <span className="text-xs text-muted-foreground">
              {status === 'open' ? 'streaming' : status}
            </span>
          </div>
          <LogViewer
            lines={lines}
            live={status === 'open'}
            height="h-[360px]"
            emptyText="No logs captured for this deployment."
          />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-sm text-foreground">
        {icon ? <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {value}
      </p>
    </div>
  );
}
