import type { FastifyInstance } from 'fastify';
import { deployTemplateSchema, Permission } from '@yourstack/shared';
import { requirePermission } from '../lib/rbac.js';
import { requireUser } from '../lib/auth.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toTemplateDTO } from '../lib/dto.js';
import { deployTemplate } from '../services/template.service.js';

/**
 * Template marketplace. The catalog is global (not workspace-scoped); deploying
 * a template translates it into a concrete managed resource inside a project.
 */
export default async function templateRoutes(app: FastifyInstance) {
  const { prisma, encryptor, queues, realtime, audit } = app.ctx;

  // Browse the catalog (auth required, any member).
  app.get('/templates', async (req) => {
    requireUser(req);
    const q = req.query as { category?: string; search?: string };
    const where: Record<string, unknown> = {};
    if (q.category) where.category = q.category;
    if (q.search) {
      const search = q.search;
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { has: search.toLowerCase() } },
      ];
    }
    const templates = await prisma.template.findMany({
      where,
      orderBy: [{ popularity: 'desc' }, { name: 'asc' }],
    });
    return { templates: templates.map(toTemplateDTO) };
  });

  app.get('/templates/:slug', async (req) => {
    requireUser(req);
    const { slug } = req.params as { slug: string };
    const template = await prisma.template.findUnique({ where: { slug } });
    if (!template) throw Errors.notFound('Template not found');
    return { template: toTemplateDTO(template) };
  });

  // Deploy a template into a project.
  app.post('/templates/deploy', async (req) => {
    const body = parse(deployTemplateSchema, req.body);
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, deletedAt: null },
    });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.TEMPLATE_DEPLOY);

    const template = await prisma.template.findUnique({ where: { slug: body.templateSlug } });
    if (!template) throw Errors.notFound('Template not found');

    const result = await deployTemplate(
      { prisma, encryptor, queues: { database: queues.database, deploy: queues.deploy }, realtime },
      { template, project, input: body, user: { id: req.user!.id, email: req.user!.email } },
    );

    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'template.deploy',
      targetType: result.resourceType,
      targetId: result.id,
      metadata: { templateSlug: template.slug, kind: result.kind },
    });

    return result;
  });
}
