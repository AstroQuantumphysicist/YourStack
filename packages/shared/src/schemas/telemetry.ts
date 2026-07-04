import { z } from 'zod';

/** Resource + system telemetry reported by the agent on each heartbeat. */
export const nodeTelemetrySchema = z.object({
  agentVersion: z.string(),
  protocolVersion: z.number().int(),
  os: z.string(),
  arch: z.string(),
  kernel: z.string().optional(),
  dockerVersion: z.string().nullable().optional(),
  cpuCores: z.number().int().nonnegative(),
  cpuUsagePercent: z.number().min(0).max(100),
  memoryTotalMb: z.number().int().nonnegative(),
  memoryUsedMb: z.number().int().nonnegative(),
  diskTotalMb: z.number().int().nonnegative(),
  diskUsedMb: z.number().int().nonnegative(),
  publicIp: z.string().nullable().optional(),
  uptimeSeconds: z.number().int().nonnegative().optional(),
  /** IDs of apps/containers the agent currently reports running. */
  runningApps: z.array(z.string()).default([]),
});
export type NodeTelemetry = z.infer<typeof nodeTelemetrySchema>;

export const heartbeatRequestSchema = z.object({
  telemetry: nodeTelemetrySchema,
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z.object({
  ok: z.literal(true),
  /** Server-side desired status the node should converge to. */
  desiredStatus: z.enum(['online', 'draining']),
  /** True if commands are waiting; agent may immediately poll. */
  hasPendingCommands: z.boolean(),
  serverTime: z.string(),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
