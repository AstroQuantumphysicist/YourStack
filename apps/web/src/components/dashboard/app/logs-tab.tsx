'use client';

import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import type { RuntimeLogLine } from '@/lib/api';
import { api } from '@/lib/api';
import { useSSE, type SSEMessage } from '@/lib/use-sse';
import { LogViewer, type LogLine } from '@/components/dashboard/log-viewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function toLine(raw: RuntimeLogLine): LogLine {
  return { id: raw.id, message: raw.message, severity: raw.severity, timestamp: raw.timestamp };
}

/** Extract a printable log line from an arbitrary SSE payload. */
function fromEvent(data: unknown, stream: string): LogLine | null {
  if (data == null) return null;
  const obj = typeof data === 'object' ? (data as Record<string, unknown>) : { message: String(data) };
  const message = typeof obj.message === 'string' ? obj.message : JSON.stringify(obj);
  return {
    id: `sse-${Math.random().toString(36).slice(2)}`,
    message,
    severity: typeof obj.severity === 'string' ? obj.severity : undefined,
    stream,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
  };
}

export function LogsTab({ appId }: { appId: string }) {
  const [search, setSearch] = useState('');
  const [liveLines, setLiveLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);

  const key = `/apps/${appId}/logs?limit=300${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const { data, isLoading, mutate } = useSWR<{ logs: RuntimeLogLine[] }>(key, () =>
    api.appLogs(appId, { limit: 300, search: search || undefined }),
  );

  // Reset live buffer when the historical query changes.
  useEffect(() => {
    setLiveLines([]);
  }, [key]);

  const onEvent = useCallback(
    (msg: SSEMessage) => {
      if (paused) return;
      if (msg.type === 'log.runtime') {
        const line = fromEvent(msg.data, 'runtime');
        if (line) setLiveLines((prev) => [...prev.slice(-500), line]);
      }
    },
    [paused],
  );

  const { status } = useSSE(`app:${appId}`, { onEvent });

  const historical = (data?.logs ?? []).map(toLine);
  const lines = [...historical, ...liveLines];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
              status === 'open'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-border bg-surface-muted text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'open' ? 'animate-pulse-dot bg-success' : 'bg-muted-foreground',
              )}
            />
            {status === 'open' ? 'streaming' : status}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => mutate()}>
            Refresh
          </Button>
        </div>
      </div>

      <LogViewer
        lines={lines}
        live={status === 'open' && !paused}
        emptyText={isLoading ? 'Loading logs…' : 'No runtime logs yet. Deploy the app to see output.'}
      />
    </div>
  );
}
