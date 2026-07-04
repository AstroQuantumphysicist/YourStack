import type { Job } from 'bullmq';
import { autoscaleJobSchema, CommandType, ScalingMetric } from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';

/** Map a scaling metric to the ResourceMetric kind the agent reports. */
const METRIC_KIND: Record<string, string> = {
  [ScalingMetric.CPU]: 'cpu_percent',
  [ScalingMetric.MEMORY]: 'mem_percent',
  [ScalingMetric.RPS]: 'rps',
  [ScalingMetric.LATENCY]: 'latency_ms',
};

export interface ReplicaDecision {
  desired: number;
  reason: string;
}

/**
 * Proportional autoscaler (pure, unit-tested): scale replicas toward keeping the
 * observed metric at `targetValue`. desired = ceil(current * observed/target),
 * clamped to [min,max]. Returns the same count when within a 10% deadband.
 */
export function computeDesiredReplicas(input: {
  current: number;
  observed: number;
  target: number;
  min: number;
  max: number;
}): ReplicaDecision {
  const { current, observed, target, min, max } = input;
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  if (target <= 0) return { desired: clamp(current), reason: 'invalid target' };
  const ratio = observed / target;
  // Deadband: avoid flapping when close to target.
  if (ratio > 0.9 && ratio < 1.1) return { desired: clamp(current), reason: 'within deadband' };
  const base = current > 0 ? current : 1;
  const desired = clamp(Math.ceil(base * ratio));
  return { desired, reason: ratio >= 1 ? 'scaling up' : 'scaling down' };
}

/** Autoscale evaluation: read recent metrics, decide replicas, dispatch SCALE_APP. */
export async function processAutoscale(ctx: WorkerContext, job: Job): Promise<void> {
  const { appId } = autoscaleJobSchema.parse(job.data);
  const { prisma } = ctx;
  const policy = await prisma.scalingPolicy.findUnique({ where: { appId } });
  if (!policy || !policy.enabled) return;

  const app = await prisma.app.findFirst({ where: { id: appId, deletedAt: null } });
  if (!app || !app.nodeId) return;

  // Respect cooldown.
  if (policy.lastScaledAt && Date.now() - policy.lastScaledAt.getTime() < policy.cooldownSeconds * 1000) {
    return;
  }

  const kind = METRIC_KIND[policy.metric] ?? 'cpu_percent';
  const since = new Date(Date.now() - 120_000);
  const recent = await prisma.resourceMetric.findMany({
    where: { scope: 'app', targetId: appId, kind, bucketTs: { gte: since } },
    orderBy: { bucketTs: 'desc' },
    take: 10,
  });
  if (recent.length === 0) return;
  const observed = recent.reduce((s, r) => s + r.value, 0) / recent.length;

  const decision = computeDesiredReplicas({
    current: policy.currentReplicas,
    observed,
    target: policy.targetValue,
    min: policy.minReplicas,
    max: policy.maxReplicas,
  });
  if (decision.desired === policy.currentReplicas) return;

  await createSignedCommand(ctx, {
    nodeId: app.nodeId,
    appId,
    payload: {
      type: CommandType.SCALE_APP,
      spec: {
        appId,
        containerName: `yourstack-${appId}`,
        replicas: decision.desired,
        resources: { cpu: app.cpu, memoryMb: app.memoryMb },
      },
    },
  });
  await prisma.scalingPolicy.update({
    where: { appId },
    data: { currentReplicas: decision.desired, lastScaledAt: new Date() },
  });
  await publish(ctx, `metrics:app:${appId}`, 'autoscale', {
    from: policy.currentReplicas,
    to: decision.desired,
    observed,
    reason: decision.reason,
  });
}
