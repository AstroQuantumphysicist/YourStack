import { PrismaClient } from '@prisma/client';
import { DEFAULT_PLAN } from '@yourstack/shared';

const prisma = new PrismaClient();

/**
 * Catalog seed — provisions ONLY the platform catalog that the product needs to
 * function: subscription plans (referenced by every workspace's FK), the region
 * catalog, and the marketplace templates. It creates NO demo users, workspaces,
 * projects, apps, or nodes: all tenant data comes from real sign-ups.
 *
 * Safe to run repeatedly (fully idempotent) and safe to run on production —
 * it is invoked automatically after each deploy migration.
 */
async function main() {
  console.log('→ Seeding plans…');
  await prisma.plan.upsert({
    where: { key: DEFAULT_PLAN.key },
    update: {},
    create: {
      key: DEFAULT_PLAN.key,
      name: DEFAULT_PLAN.name,
      maxNodes: DEFAULT_PLAN.maxNodes,
      maxApps: DEFAULT_PLAN.maxApps,
      maxDeploymentsPerDay: DEFAULT_PLAN.maxDeploymentsPerDay,
      logRetentionDays: DEFAULT_PLAN.logRetentionDays,
      priceCents: 0,
    },
  });
  await prisma.plan.upsert({
    where: { key: 'pro' },
    update: {},
    create: {
      key: 'pro',
      name: 'Pro',
      maxNodes: 25,
      maxApps: 200,
      maxDeploymentsPerDay: 2000,
      logRetentionDays: 90,
      priceCents: 2000,
    },
  });

  console.log('→ Seeding region catalog…');
  const regions = [
    { slug: 'fsn1', name: 'Falkenstein', country: 'Germany', flag: '🇩🇪' },
    { slug: 'ash', name: 'Ashburn', country: 'United States', flag: '🇺🇸' },
    { slug: 'sin', name: 'Singapore', country: 'Singapore', flag: '🇸🇬' },
    { slug: 'lhr', name: 'London', country: 'United Kingdom', flag: '🇬🇧' },
    { slug: 'syd', name: 'Sydney', country: 'Australia', flag: '🇦🇺' },
  ];
  for (const r of regions) {
    await prisma.region.upsert({ where: { slug: r.slug }, update: {}, create: r });
  }

  console.log('→ Seeding marketplace templates…');
  const { TEMPLATE_CATALOG } = await import('./templates.js');
  for (const t of TEMPLATE_CATALOG) {
    await prisma.template.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        category: t.category,
        kind: t.kind,
        description: t.description,
        icon: t.icon,
        image: t.image,
        tags: t.tags,
        popularity: t.popularity,
        spec: t.spec as never,
      },
      create: {
        slug: t.slug,
        name: t.name,
        category: t.category,
        kind: t.kind,
        description: t.description,
        icon: t.icon,
        image: t.image,
        tags: t.tags,
        popularity: t.popularity,
        spec: t.spec as never,
      },
    });
  }
  console.log(`  ${TEMPLATE_CATALOG.length} templates seeded.`);

  console.log('\n✔ Catalog seed complete (plans, regions, templates). No demo/tenant data created.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
