import type { FastifyInstance } from 'fastify';
import { Permission } from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { toAuditDTO } from '../lib/dto.js';

export default async function auditRoutes(app: FastifyInstance) {
  const { prisma } = app.ctx;

  app.get('/workspaces/:wid/audit', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.AUDIT_VIEW);
    const q = req.query as { limit?: string; action?: string };
    const logs = await prisma.auditLog.findMany({
      where: { workspaceId: wid, action: q.action ?? undefined },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit ?? 100), 500),
    });
    return { logs: logs.map(toAuditDTO) };
  });
}
