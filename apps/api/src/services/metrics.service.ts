import type { PrismaClient } from '@yourstack/db';
import { SSE_CHANNELS, type MetricBatch, type MetricSeries } from '@yourstack/shared';
import type { RealtimeHub } from '../realtime/hub.js';

/** Round a timestamp down to the nearest `stepSeconds` bucket. */
export function bucketTimestamp(date: Date, stepSeconds: number): Date {
  const ms = stepSeconds * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/**
 * Ingest a batch of agent-reported metric points. Points are upserted into
 * downsampled buckets (keyed by scope+target+kind+instance+bucketTs) so storage
 * stays bounded, and streamed live to the resource's metrics channel.
 */
export async function ingestMetrics(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  batch: MetricBatch,
  stepSeconds = 60,
): Promise<number> {
  let count = 0;
  for (const p of batch.points) {
    const ts = new Date(p.timestamp);
    if (Number.isNaN(ts.getTime())) continue;
    const bucketTs = bucketTimestamp(ts, stepSeconds);
    const instance = p.instance ?? '';
    await prisma.resourceMetric.upsert({
      where: {
        scope_targetId_kind_instance_bucketTs: {
          scope: p.scope,
          targetId: p.targetId,
          kind: p.kind,
          instance,
          bucketTs,
        },
      },
      create: {
        scope: p.scope,
        targetId: p.targetId,
        kind: p.kind,
        value: p.value,
        instance,
        nodeId: batch.nodeId ?? null,
        bucketTs,
      },
      // Last-write-wins within a bucket (agents sample faster than the bucket).
      update: { value: p.value, nodeId: batch.nodeId ?? null },
    });
    await realtime.publish(SSE_CHANNELS.metrics(p.scope, p.targetId), 'metric', {
      kind: p.kind,
      value: p.value,
      instance: p.instance,
      t: bucketTs.toISOString(),
    });
    count++;
  }
  return count;
}

/** Query downsampled metric series for a target over a window. */
export async function queryMetrics(
  prisma: PrismaClient,
  args: { scope: string; targetId: string; kinds?: string[]; windowSeconds: number },
): Promise<MetricSeries[]> {
  const since = new Date(Date.now() - args.windowSeconds * 1000);
  const rows = await prisma.resourceMetric.findMany({
    where: {
      scope: args.scope as never,
      targetId: args.targetId,
      kind: args.kinds ? { in: args.kinds } : undefined,
      bucketTs: { gte: since },
    },
    orderBy: { bucketTs: 'asc' },
  });
  const byKind = new Map<string, MetricSeries>();
  for (const r of rows) {
    let series = byKind.get(r.kind);
    if (!series) {
      series = { kind: r.kind, points: [] };
      byKind.set(r.kind, series);
    }
    series.points.push({ t: r.bucketTs.toISOString(), v: r.value });
  }
  return Array.from(byKind.values());
}
