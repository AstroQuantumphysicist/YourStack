import type { FastifyInstance } from 'fastify';
import { createApiTokenSchema, Permission } from '@yourstack/shared';
import { generateApiToken, AuditAction } from '@yourstack/security';
import { requireUser } from '../lib/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toApiTokenDTO } from '../lib/dto.js';

export default async function tokenRoutes(app: FastifyInstance) {
  const { prisma, audit } = app.ctx;

  app.get('/workspaces/:wid/tokens', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.TOKEN_VIEW);
    const tokens = await prisma.apiToken.findMany({
      where: { workspaceId: wid, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { tokens: tokens.map(toApiTokenDTO) };
  });

  app.post('/workspaces/:wid/tokens', async (req) => {
    const { wid } = req.params as { wid: string };
    const user = requireUser(req);
    await requirePermission(prisma, req, wid, Permission.TOKEN_CREATE);
    const body = parse(createApiTokenSchema, req.body);
    const token = generateApiToken();
    const created = await prisma.apiToken.create({
      data: {
        userId: user.id,
        workspaceId: wid,
        name: body.name,
        tokenHash: token.hash,
        lastFour: token.lastFour,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86400_000) : null,
      },
    });
    await audit({ workspaceId: wid, actorId: user.id, actorEmail: user.email, action: AuditAction.TOKEN_CREATE, targetType: 'token', targetId: created.id });
    // Plaintext returned exactly once.
    return { token: toApiTokenDTO(created), plaintext: token.plaintext };
  });

  app.delete('/workspaces/:wid/tokens/:id', async (req, reply) => {
    const { wid, id } = req.params as { wid: string; id: string };
    await requirePermission(prisma, req, wid, Permission.TOKEN_REVOKE);
    const token = await prisma.apiToken.findFirst({ where: { id, workspaceId: wid } });
    if (!token) throw Errors.notFound('Token not found');
    await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({ workspaceId: wid, actorId: req.user!.id, actorEmail: req.user!.email, action: AuditAction.TOKEN_REVOKE, targetType: 'token', targetId: id });
    reply.status(204).send();
  });
}
