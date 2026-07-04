import type { Job } from 'bullmq';
import {
  CommandType,
  firewallJobSchema,
  SSE_CHANNELS,
  type ConfigureFirewallSpec,
  type FirewallRuleSpec,
} from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';

/** The minimal shape of a persisted firewall rule the spec builder needs. */
export interface FirewallRuleRow {
  direction: string;
  action: string;
  protocol: string;
  port: string | null;
  cidr: string;
  comment: string | null;
  position: number;
}

/**
 * Map persisted Firewall + FirewallRule rows to a ConfigureFirewallSpec. Pure so
 * it can be unit-tested without a database. Rules are emitted in `position`
 * order and normalized to the enum values the agent expects.
 */
export function buildFirewallSpec(
  firewall: { id: string; defaultInbound: string; defaultOutbound: string },
  rules: FirewallRuleRow[],
): ConfigureFirewallSpec {
  const mapped: FirewallRuleSpec[] = [...rules]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      direction: r.direction === 'outbound' ? 'outbound' : 'inbound',
      action: r.action === 'deny' ? 'deny' : 'allow',
      protocol: normalizeProtocol(r.protocol),
      port: r.port ?? undefined,
      cidr: r.cidr || '0.0.0.0/0',
      comment: r.comment ?? undefined,
    }));

  return {
    firewallId: firewall.id,
    defaultInbound: firewall.defaultInbound === 'allow' ? 'allow' : 'deny',
    defaultOutbound: firewall.defaultOutbound === 'deny' ? 'deny' : 'allow',
    rules: mapped,
  };
}

/**
 * A "flush": drop all rules and open both directions. Dispatched on `remove` so
 * the node stops enforcing the firewall's policy without leaving it locked out.
 */
export function buildFlushSpec(firewallId: string): ConfigureFirewallSpec {
  return { firewallId, defaultInbound: 'allow', defaultOutbound: 'allow', rules: [] };
}

function normalizeProtocol(p: string): FirewallRuleSpec['protocol'] {
  return p === 'udp' || p === 'icmp' || p === 'any' ? p : 'tcp';
}

/** Firewall processor: fan a signed CONFIGURE_FIREWALL command out to each node. */
export async function processFirewall(ctx: WorkerContext, job: Job): Promise<void> {
  const data = firewallJobSchema.parse(job.data);
  const { prisma } = ctx;
  const firewall = await prisma.firewall.findUnique({
    where: { id: data.firewallId },
    include: { rules: true },
  });
  if (!firewall || firewall.deletedAt) return;

  const spec = data.action === 'apply' ? buildFirewallSpec(firewall, firewall.rules) : buildFlushSpec(firewall.id);
  const status = data.action === 'apply' ? 'applying' : 'draft';
  await prisma.firewall.update({ where: { id: firewall.id }, data: { status } });

  for (const nodeId of firewall.nodeIds) {
    await createSignedCommand(ctx, {
      nodeId,
      timeoutMs: 2 * 60_000,
      payload: { type: CommandType.CONFIGURE_FIREWALL, spec },
    });
  }

  await publish(ctx, SSE_CHANNELS.firewall(firewall.id), 'firewall.status', {
    firewallId: firewall.id,
    status,
    action: data.action,
    nodes: firewall.nodeIds.length,
  });
}
