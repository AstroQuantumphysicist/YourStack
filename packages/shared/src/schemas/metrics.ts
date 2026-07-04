import { z } from 'zod';

/**
 * Metrics protocol. The agent samples per-container + per-node resource usage
 * (CPU, RAM, requests/sec, latency, network, disk, replica count) and posts
 * batches to the control plane, which stores them as a downsampled time series
 * and streams them to the dashboard for live "worker load" inspection.
 */
export const metricPointSchema = z.object({
  scope: z.enum(['app', 'node', 'database', 'function']),
  /** Id of the app/node/database/function this sample belongs to. */
  targetId: z.string(),
  kind: z.enum([
    'cpu_percent',
    'mem_mb',
    'mem_percent',
    'rps',
    'latency_ms',
    'net_rx_kb',
    'net_tx_kb',
    'disk_mb',
    'replicas',
  ]),
  value: z.number(),
  /** Optional replica/instance discriminator. */
  instance: z.string().optional(),
  timestamp: z.string(),
});
export type MetricPoint = z.infer<typeof metricPointSchema>;

export const metricBatchSchema = z.object({
  nodeId: z.string().optional(),
  points: z.array(metricPointSchema).max(2000),
});
export type MetricBatch = z.infer<typeof metricBatchSchema>;

export const metricQuerySchema = z.object({
  scope: z.enum(['app', 'node', 'database', 'function']),
  targetId: z.string(),
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined)),
  /** Lookback window in seconds (default 1h). */
  windowSeconds: z.coerce.number().int().positive().default(3600),
  /** Aggregation bucket in seconds (default 60). */
  stepSeconds: z.coerce.number().int().positive().default(60),
});
export type MetricQuery = z.infer<typeof metricQuerySchema>;

export interface MetricSeries {
  kind: string;
  points: Array<{ t: string; v: number }>;
}
