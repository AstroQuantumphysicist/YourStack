'use client';

import { useState } from 'react';
import { Activity, Radio } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/utils';
import {
  metaFor,
  RANGES,
  useMetrics,
  type RangeOption,
} from '@/lib/metrics';
import type { MetricScopeName } from '@/lib/api';
import { TimeSeriesChart } from './time-series-chart';

/** Sensible default metric kinds per scope. */
export const DEFAULT_KINDS: Record<MetricScopeName, string[]> = {
  app: ['cpu_percent', 'mem_mb', 'rps', 'latency_ms'],
  node: ['cpu_percent', 'mem_mb', 'net_rx_kb', 'disk_mb'],
  database: ['cpu_percent', 'mem_mb'],
  function: ['rps', 'latency_ms'],
};

export function RangeSelector({
  value,
  onChange,
  className,
}: {
  value: RangeOption;
  onChange: (r: RangeOption) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex items-center rounded-lg border border-border bg-surface-muted p-0.5', className)}>
      {RANGES.map((r) => (
        <button
          key={r.label}
          onClick={() => onChange(r)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            r.label === value.label
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Radio className={cn('h-3.5 w-3.5', live ? 'text-success' : 'text-muted-foreground')} />
      {live ? (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-success" /> Live
        </span>
      ) : (
        'Paused'
      )}
    </span>
  );
}

interface MetricsPanelProps {
  scope: MetricScopeName;
  targetId: string | null | undefined;
  kinds?: string[];
  live?: boolean;
  /** Chart height in px. */
  height?: number;
  className?: string;
}

/**
 * A drop-in observability panel: a shared range selector, a live indicator, and
 * one crisp chart per metric kind with its current value. Reused on the app,
 * node, database and function detail pages.
 */
export function MetricsPanel({
  scope,
  targetId,
  kinds = DEFAULT_KINDS[scope],
  live = true,
  height = 180,
  className,
}: MetricsPanelProps) {
  const [range, setRange] = useState<RangeOption>(RANGES[1]!);
  const { series, latest, error, isLoading, mutate } = useMetrics({
    scope,
    targetId,
    kinds,
    range,
    live,
  });

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Activity className="h-4 w-4 text-primary" /> Live metrics
        </div>
        <div className="flex items-center gap-3">
          <LiveDot live={live} />
          <RangeSelector value={range} onChange={setRange} />
        </div>
      </div>

      {error ? (
        <ErrorState message="Could not load metrics." onRetry={() => mutate()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {kinds.map((kind) => {
            const meta = metaFor(kind);
            const s = series.find((x) => x.kind === kind);
            const value = latest[kind];
            const forceMax = meta.unit === '%' ? 100 : undefined;
            return (
              <Card key={kind} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{meta.label}</p>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                  />
                </div>
                {isLoading && !s ? (
                  <Skeleton className="mt-2 h-7 w-20" />
                ) : (
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                    {value != null ? meta.format(value) : '—'}
                  </p>
                )}
                <div className="mt-3">
                  {isLoading && !s ? (
                    <Skeleton className="w-full rounded-lg" style={{ height }} />
                  ) : (
                    <TimeSeriesChart
                      series={s ? [s] : []}
                      height={height}
                      yMax={forceMax}
                      area
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
