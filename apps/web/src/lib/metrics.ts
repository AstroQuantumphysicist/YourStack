'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { MetricSeries } from '@yourstack/shared';
import { api, type MetricScopeName } from './api';
import { useSSE } from './use-sse';

/** A single point in a rendered series. `t` is epoch milliseconds. */
export interface Point {
  t: number;
  v: number;
}

export interface RenderSeries {
  kind: string;
  label: string;
  unit: string;
  color: string;
  points: Point[];
}

/* -------------------------------- Kind metadata ------------------------------ */

export interface MetricMeta {
  kind: string;
  label: string;
  unit: string;
  /** CSS color (references a theme token so it adapts to light/dark). */
  color: string;
  /** Format a raw value for axis ticks / tooltips. */
  format: (v: number) => string;
}

const round = (v: number, d = 0) => {
  const p = 10 ** d;
  return Math.round(v * p) / p;
};

export const METRIC_META: Record<string, MetricMeta> = {
  cpu_percent: {
    kind: 'cpu_percent',
    label: 'CPU',
    unit: '%',
    color: 'hsl(250 88% 66%)',
    format: (v) => `${round(v)}%`,
  },
  mem_mb: {
    kind: 'mem_mb',
    label: 'Memory',
    unit: 'MB',
    color: 'hsl(190 92% 55%)',
    format: (v) => (v >= 1024 ? `${round(v / 1024, 1)} GB` : `${round(v)} MB`),
  },
  mem_percent: {
    kind: 'mem_percent',
    label: 'Memory',
    unit: '%',
    color: 'hsl(190 92% 55%)',
    format: (v) => `${round(v)}%`,
  },
  rps: {
    kind: 'rps',
    label: 'Requests',
    unit: 'req/s',
    color: 'hsl(152 62% 46%)',
    format: (v) => `${round(v, v < 10 ? 1 : 0)} req/s`,
  },
  latency_ms: {
    kind: 'latency_ms',
    label: 'Latency',
    unit: 'ms',
    color: 'hsl(38 92% 56%)',
    format: (v) => `${round(v)} ms`,
  },
  net_rx_kb: {
    kind: 'net_rx_kb',
    label: 'Net in',
    unit: 'KB/s',
    color: 'hsl(210 90% 62%)',
    format: (v) => (v >= 1024 ? `${round(v / 1024, 1)} MB/s` : `${round(v)} KB/s`),
  },
  net_tx_kb: {
    kind: 'net_tx_kb',
    label: 'Net out',
    unit: 'KB/s',
    color: 'hsl(280 80% 66%)',
    format: (v) => (v >= 1024 ? `${round(v / 1024, 1)} MB/s` : `${round(v)} KB/s`),
  },
  disk_mb: {
    kind: 'disk_mb',
    label: 'Disk',
    unit: 'MB',
    color: 'hsl(217 15% 62%)',
    format: (v) => (v >= 1024 ? `${round(v / 1024, 1)} GB` : `${round(v)} MB`),
  },
  replicas: {
    kind: 'replicas',
    label: 'Replicas',
    unit: '',
    color: 'hsl(250 88% 66%)',
    format: (v) => `${round(v)}`,
  },
};

export function metaFor(kind: string): MetricMeta {
  return (
    METRIC_META[kind] ?? {
      kind,
      label: kind,
      unit: '',
      color: 'hsl(var(--primary))',
      format: (v: number) => `${round(v, 1)}`,
    }
  );
}

/* --------------------------------- Ranges ----------------------------------- */

export interface RangeOption {
  label: string;
  windowSeconds: number;
  stepSeconds: number;
}

export const RANGES: RangeOption[] = [
  { label: '15m', windowSeconds: 15 * 60, stepSeconds: 15 },
  { label: '1h', windowSeconds: 60 * 60, stepSeconds: 60 },
  { label: '6h', windowSeconds: 6 * 60 * 60, stepSeconds: 5 * 60 },
  { label: '24h', windowSeconds: 24 * 60 * 60, stepSeconds: 15 * 60 },
];

/* ---------------------------------- Hook ------------------------------------ */

interface UseMetricsOptions {
  scope: MetricScopeName;
  targetId: string | null | undefined;
  kinds: string[];
  range: RangeOption;
  /** Subscribe to live SSE points and append them in place. */
  live?: boolean;
}

function toRenderSeries(series: MetricSeries[], kinds: string[]): RenderSeries[] {
  const byKind = new Map(series.map((s) => [s.kind, s]));
  return kinds.map((kind) => {
    const meta = metaFor(kind);
    const raw = byKind.get(kind);
    const points: Point[] = (raw?.points ?? [])
      .map((p) => ({ t: new Date(p.t).getTime(), v: p.v }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    return { kind, label: meta.label, unit: meta.unit, color: meta.color, points };
  });
}

/**
 * Fetch a set of metric series for a resource, then live-append incoming SSE
 * points so the chart animates in real time. Returns render-ready series.
 */
export function useMetrics({ scope, targetId, kinds, range, live = true }: UseMetricsOptions) {
  const kindsKey = kinds.join(',');
  const key = targetId
    ? ['metrics', scope, targetId, kindsKey, range.windowSeconds, range.stepSeconds]
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () =>
      api.metrics({
        scope,
        targetId: targetId!,
        kinds,
        windowSeconds: range.windowSeconds,
        stepSeconds: range.stepSeconds,
      }),
    { refreshInterval: live ? 0 : 30_000 },
  );

  // Live points appended on top of the fetched baseline.
  const [liveExtra, setLiveExtra] = useState<Record<string, Point[]>>({});
  const windowRef = useRef(range.windowSeconds);
  windowRef.current = range.windowSeconds;

  // Reset the live buffer whenever the query identity changes.
  useEffect(() => {
    setLiveExtra({});
  }, [scope, targetId, kindsKey, range.windowSeconds]);

  const onEvent = useCallback(
    (msg: { type: string; data: unknown }) => {
      if (msg.type !== 'metric') return;
      const d = msg.data as { kind?: string; value?: number; t?: string | number } | null;
      if (!d || typeof d.kind !== 'string' || typeof d.value !== 'number') return;
      if (!kinds.includes(d.kind)) return;
      const t = d.t ? new Date(d.t).getTime() : Date.now();
      if (!Number.isFinite(t)) return;
      const cutoff = Date.now() - windowRef.current * 1000;
      setLiveExtra((prev) => {
        const existing = prev[d.kind!] ?? [];
        const next = [...existing, { t, v: d.value! }]
          .filter((p) => p.t >= cutoff)
          .slice(-600);
        return { ...prev, [d.kind!]: next };
      });
    },
    [kinds],
  );

  useSSE(live && targetId ? `metrics:${scope}:${targetId}` : null, { onEvent });

  const series = useMemo(() => {
    const base = toRenderSeries(data?.series ?? [], kinds);
    if (Object.keys(liveExtra).length === 0) return base;
    return base.map((s) => {
      const extra = liveExtra[s.kind];
      if (!extra || extra.length === 0) return s;
      const lastBase = s.points.length ? s.points[s.points.length - 1]!.t : 0;
      const merged = [...s.points, ...extra.filter((p) => p.t > lastBase)].sort(
        (a, b) => a.t - b.t,
      );
      return { ...s, points: merged };
    });
  }, [data, kinds, liveExtra]);

  const latest = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const s of series) out[s.kind] = s.points.length ? s.points[s.points.length - 1]!.v : null;
    return out;
  }, [series]);

  return { series, latest, error, isLoading, mutate };
}
