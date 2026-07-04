import type { FastifyInstance } from 'fastify';
import { createRegionSchema } from '@yourstack/shared';
import { requireUser } from '../lib/auth.js';
import { requirePlatformAdmin } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { toRegionDTO } from '../lib/dto.js';

export default async function regionRoutes(app: FastifyInstance) {
  const { prisma } = app.ctx;

  // Any authenticated user can read the region catalog (for placement pickers).
  app.get('/regions', async (req) => {
    requireUser(req);
    const regions = await prisma.region.findMany({ orderBy: { name: 'asc' } });
    const counts = await prisma.node.groupBy({
      by: ['region'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const countBySlug = new Map(counts.map((c) => [c.region ?? '', c._count._all]));
    return { regions: regions.map((r) => toRegionDTO(r, countBySlug.get(r.slug) ?? 0)) };
  });

  // Platform admins manage the global region catalog.
  app.post('/admin/regions', async (req) => {
    requirePlatformAdmin(req);
    const body = parse(createRegionSchema, req.body);
    const region = await prisma.region.upsert({
      where: { slug: body.slug },
      create: body,
      update: { name: body.name, country: body.country, flag: body.flag },
    });
    return { region: toRegionDTO(region, 0) };
  });
}
