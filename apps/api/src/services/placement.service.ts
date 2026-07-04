import type { PrismaClient } from '@yourstack/db';
import { Errors } from '../lib/errors.js';

/**
 * Choose a node in a workspace to place a managed resource on. Prefers an
 * explicit node, then an online node in the requested region, then any online
 * node. This is the placement primitive behind region-aware provisioning.
 */
export async function pickNode(
  prisma: PrismaClient,
  workspaceId: string,
  opts: { nodeId?: string; region?: string } = {},
): Promise<string> {
  if (opts.nodeId) {
    const node = await prisma.node.findFirst({
      where: { id: opts.nodeId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!node) throw Errors.badRequest('Requested node not found in this workspace');
    return node.id;
  }

  const online = await prisma.node.findMany({
    where: { workspaceId, deletedAt: null, status: 'online', disabled: false },
    select: { id: true, region: true },
    orderBy: { lastHeartbeatAt: 'desc' },
  });
  if (online.length === 0) {
    throw Errors.badRequest('No online node available. Connect a node before provisioning resources.');
  }
  if (opts.region) {
    const inRegion = online.find((n) => n.region === opts.region);
    if (inRegion) return inRegion.id;
  }
  return online[0]!.id;
}

/** Allocate a deterministic-ish host port for a managed resource in a safe range. */
export function allocatePort(seed: string, base = 20000, span = 20000): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return base + (h % span);
}
