import type { FastifyInstance } from 'fastify';
import { createProjectSchema, updateProjectSchema, Permission } from '@noderail/shared';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { slugify } from '../lib/util.js';
import { toProjectDTO } from '../lib/dto.js';

export default async function projectRoutes(app: FastifyInstance) {
  const { prisma } = app.ctx;

  app.get('/workspaces/:wid/projects', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.PROJECT_VIEW);
    const projects = await prisma.project.findMany({
      where: { workspaceId: wid, deletedAt: null },
      include: { _count: { select: { apps: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { projects: projects.map(toProjectDTO) };
  });

  app.post('/workspaces/:wid/projects', async (req) => {
    const { wid } = req.params as { wid: string };
    await requirePermission(prisma, req, wid, Permission.PROJECT_CREATE);
    const body = parse(createProjectSchema, req.body);
    const slug = body.slug ?? slugify(body.name);
    const exists = await prisma.project.findUnique({
      where: { workspaceId_slug: { workspaceId: wid, slug } },
    });
    if (exists) throw Errors.conflict('A project with that slug already exists');

    const project = await prisma.project.create({
      data: { workspaceId: wid, name: body.name, slug, description: body.description ?? null },
      include: { _count: { select: { apps: true } } },
    });
    return { project: toProjectDTO(project) };
  });

  app.get('/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { apps: true } } },
    });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.PROJECT_VIEW);
    return { project: toProjectDTO(project) };
  });

  app.patch('/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.PROJECT_UPDATE);
    const body = parse(updateProjectSchema, req.body);
    const updated = await prisma.project.update({
      where: { id },
      data: { name: body.name, description: body.description },
      include: { _count: { select: { apps: true } } },
    });
    return { project: toProjectDTO(updated) };
  });

  app.delete('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.PROJECT_DELETE);
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    reply.status(204).send();
  });
}
