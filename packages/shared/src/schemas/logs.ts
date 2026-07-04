import { z } from 'zod';
import { LogSeverity, LogStream } from '../enums.js';

/** A single log line ingested from the agent (build or runtime output). */
export const logEventSchema = z.object({
  appId: z.string(),
  deploymentId: z.string().nullable().optional(),
  nodeId: z.string().nullable().optional(),
  stream: z.enum([LogStream.BUILD, LogStream.RUNTIME, LogStream.SYSTEM]),
  severity: z
    .enum([LogSeverity.DEBUG, LogSeverity.INFO, LogSeverity.WARN, LogSeverity.ERROR])
    .default(LogSeverity.INFO),
  message: z.string(),
  timestamp: z.string(),
  /** Optional structured fields. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type LogEvent = z.infer<typeof logEventSchema>;

/** Batched log ingestion from the agent's log-stream command. */
export const logBatchSchema = z.object({
  commandId: z.string().optional(),
  events: z.array(logEventSchema).max(1000),
});
export type LogBatch = z.infer<typeof logBatchSchema>;

/** Query filters for reading logs. */
export const logQuerySchema = z.object({
  appId: z.string().optional(),
  deploymentId: z.string().optional(),
  stream: z.enum([LogStream.BUILD, LogStream.RUNTIME, LogStream.SYSTEM]).optional(),
  severity: z
    .enum([LogSeverity.DEBUG, LogSeverity.INFO, LogSeverity.WARN, LogSeverity.ERROR])
    .optional(),
  search: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type LogQuery = z.infer<typeof logQuerySchema>;
