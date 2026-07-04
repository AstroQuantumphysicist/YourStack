import type { PrismaClient } from '@yourstack/db';

/** Return the id of an online, enabled node in the workspace, or null. */
export async function pickOnlineNode(prisma: PrismaClient, workspaceId: string): Promise<string | null> {
  const node = await prisma.node.findFirst({
    where: { workspaceId, deletedAt: null, status: 'online', disabled: false },
    orderBy: { lastHeartbeatAt: 'desc' },
    select: { id: true },
  });
  return node?.id ?? null;
}
