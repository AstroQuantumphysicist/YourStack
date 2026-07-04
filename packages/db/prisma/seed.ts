import { PrismaClient } from '@prisma/client';
import { generateApiToken, generateCommandKey, hashPassword } from '@yourstack/security';
import { DEFAULT_PLAN } from '@yourstack/shared';

const prisma = new PrismaClient();

/**
 * Idempotent seed: default plans, a demo admin user, a demo workspace with a
 * project, an app, and a fake offline node. Safe to run repeatedly.
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

  console.log('→ Seeding demo user + workspace…');
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@yourstack.local';
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isPlatformAdmin: true },
    create: {
      email: adminEmail,
      name: 'Demo Admin',
      isPlatformAdmin: true,
      passwordHash: await hashPassword('yourstack-dev'),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Workspace',
      slug: 'demo',
      planKey: DEFAULT_PLAN.key,
      members: {
        create: { userId: user.id, role: 'owner' },
      },
    },
  });

  console.log('→ Seeding demo project + app…');
  const project = await prisma.project.upsert({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: 'starter' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Starter',
      slug: 'starter',
      description: 'A demo project to get you started.',
    },
  });

  await prisma.app.upsert({
    where: { projectId_slug: { projectId: project.id, slug: 'web' } },
    update: {},
    create: {
      projectId: project.id,
      name: 'web',
      slug: 'web',
      framework: 'nextjs',
      repoUrl: 'https://github.com/yourstack/example-next',
      branch: 'main',
      installCommand: 'pnpm install --frozen-lockfile',
      buildCommand: 'pnpm build',
      startCommand: 'pnpm start',
      port: 3000,
      status: 'idle',
    },
  });

  console.log('→ Seeding demo node (offline)…');
  await prisma.node.upsert({
    where: { id: 'seed-node-1' },
    update: {},
    create: {
      id: 'seed-node-1',
      workspaceId: workspace.id,
      name: 'demo-hetzner-fsn1',
      status: 'offline',
      region: 'fsn1',
      os: 'linux',
      arch: 'x86_64',
      commandKey: generateCommandKey(32),
      cpuCores: 4,
      memoryTotalMb: 8192,
      diskTotalMb: 160_000,
      labels: {
        create: [
          { key: 'provider', value: 'hetzner' },
          { key: 'env', value: 'demo' },
        ],
      },
    },
  });

  const token = generateApiToken();
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

  console.log('\n✔ Seed complete.');
  console.log(`  Admin user:   ${adminEmail} (password: yourstack-dev)`);
  console.log(`  Workspace:    demo`);
  console.log(`  Sample API token (not stored): ${token.plaintext}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
