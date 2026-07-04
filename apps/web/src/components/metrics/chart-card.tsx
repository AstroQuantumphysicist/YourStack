'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { metaFor, useMetrics, type RangeOption } from '@/lib/metrics';
import type { MetricScopeName } from '@/lib/api';
import { TimeSeriesChart } from './time-series-chart';

/**
 * A single titled metrics chart that fetches its own series (one or more kinds,
 * rendered as a multi-series overlay) and live-appends SSE points. Shares an
 * externally-controlled time range.
 */
export function ChartCard({
  title,
  scope,
  targetId,
  kinds,
  range,
  height = 200,
  yMax,
  live = true,
}: {
  title: string;
  scope: MetricScopeName;
  targetId: string | null | undefined;
  kinds: string[];
  range: RangeOption;
  height?: number;
  yMax?: number;
  live?: boolean;
}) {
  const { series, latest, error, isLoading, mutate } = useMetrics({
    scope,
    targetId,
    kinds,
    range,
    live,
  });

  const multi = kinds.length > 1;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {multi ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {kinds.map((k) => {
                const meta = metaFor(k);
                return (
                  <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                    {meta.label}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
              {latest[kinds[0]!] != null ? metaFor(kinds[0]!).format(latest[kinds[0]!]!) : '—'}
            </p>
          )}
        </div>
      </div>

      {error ? (
        <ErrorState message="Metrics unavailable." onRetry={() => mutate()} />
      ) : isLoading && series.every((s) => s.points.length === 0) ? (
        <Skeleton className="w-full rounded-lg" style={{ height }} />
      ) : (
        <TimeSeriesChart series={series} height={height} yMax={yMax} area={!multi} />
      )}
    </Card>
  );
}
