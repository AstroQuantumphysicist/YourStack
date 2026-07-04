import type { Job } from 'bullmq';
import {
  CommandType,
  loadBalancerJobSchema,
  SSE_CHANNELS,
  type LBAlgorithm,
  type ProvisionLbSpec,
} from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';
import { pickOnlineNode } from '../lib/placement.js';

/** The minimal shape of a persisted LB target the spec builder needs. */
export interface LBTargetRow {
  address: string;
  weight: number;
}

/**
 * Collapse duplicate targets by address, summing their weights, preserving first
 * appearance order. Pure so it can be unit-tested. Blank addresses are dropped.
 */
export function dedupeTargets(targets: LBTargetRow[]): { address: string; weight: number }[] {
  const byAddress = new Map<string, number>();
  for (const t of targets) {
    const address = t.address.trim();
    if (!address) continue;
    const weight = Number.isFinite(t.weight) && t.weight > 0 ? Math.trunc(t.weight) : 1;
    byAddress.set(address, (byAddress.get(address) ?? 0) + weight);
  }
  return [...byAddress.entries()].map(([address, weight]) => ({ address, weight }));
}

const CONTAINER_NAME = (id: string): string => `yourstack-lb-${id}`;

/** Load-balancer processor: dispatch provision/remove/reconcile to a node. */
export async function processLoadBalancer(ctx: WorkerContext, job: Job): Promise<void> {
  const data = loadBalancerJobSchema.parse(job.data);
  const { prisma } = ctx;
  const lb = await prisma.loadBalancer.findUnique({
    where: { id: data.loadBalancerId },
    include: { targets: true, project: true },
  });
  if (!lb || lb.deletedAt) return;

  const containerName = lb.containerName ?? CONTAINER_NAME(lb.id);
  if (!lb.containerName) {
    await prisma.loadBalancer.update({ where: { id: lb.id }, data: { containerName } });
  }

  // Resolve a node: the LB's pinned node, else any online node in its workspace.
  const nodeId = lb.nodeId ?? (await pickOnlineNode(prisma, lb.project.workspaceId));
  if (!nodeId) return;
  if (!lb.nodeId) await prisma.loadBalancer.update({ where: { id: lb.id }, data: { nodeId } });

  if (data.action === 'remove') {
    await createSignedCommand(ctx, {
      nodeId,
      payload: { type: CommandType.REMOVE_LB, spec: { loadBalancerId: lb.id, containerName } },
    });
  } else {
    // provision + reconcile both (re-)apply the current target set.
    const targets = dedupeTargets(lb.targets);
    if (targets.length === 0) return;
    const spec: ProvisionLbSpec = {
      loadBalancerId: lb.id,
      containerName,
      listenPort: lb.listenPort,
      algorithm: lb.algorithm as LBAlgorithm,
      targets,
      domain: lb.domain ?? undefined,
      autoHttps: lb.autoHttps,
      healthPath: '/',
      sticky: lb.sticky,
    };
    await prisma.loadBalancer.update({ where: { id: lb.id }, data: { status: 'provisioning' } });
    await createSignedCommand(ctx, {
      nodeId,
      timeoutMs: 5 * 60_000,
      payload: { type: CommandType.PROVISION_LB, spec },
    });
  }

  await publish(ctx, SSE_CHANNELS.loadBalancer(lb.id), 'loadbalancer.status', {
    loadBalancerId: lb.id,
    action: data.action,
    status: lb.status,
  });
}
