import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import {
  applyBlueprintSchema,
  Permission,
  QUEUE_NAMES,
  type AppFramework,
  type Blueprint,
  type BlueprintPlanItem,
  type DatabaseJob,
  type FunctionJob,
  type LBAlgorithm,
  type LoadBalancerJob,
  type StorageJob,
} from '@yourstack/shared';
import { generateApiToken, randomToken } from '@yourstack/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { slugify } from '../lib/util.js';
import { pickNode, allocatePort } from '../services/placement.service.js';
import { resolveLbTargets, type AppAddress } from '../services/loadbalancer.service.js';
import {
  parseBlueprint,
  computeBlueprintPlan,
  emptyExisting,
  type ExistingResources,
} from '../services/blueprint.service.js';

/** Coerce a blueprint memory/storage value (number of MB, or a string) to MB. */
function toMb(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const m = /^(\d+(?:\.\d+)?)\s*(gb|g|mb|m)?$/i.exec(value.trim());
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] ?? 'mb').toLowerCase();
      return Math.round(unit.startsWith('g') ? n * 1024 : n);
    }
  }
  return fallback;
}

export default async function blueprintRoutes(app: FastifyInstance) {
  const { prisma, queues, encryptor, audit, realtime } = app.ctx;

  app.post('/blueprint/apply', async (req) => {
    const body = parse(applyBlueprintSchema, req.body);
    await requirePermission(prisma, req, body.workspaceId, Permission.BLUEPRINT_APPLY);

    const parsed = parseBlueprint(body.blueprint);
    if (!parsed.ok || !parsed.blueprint) throw Errors.badRequest('Invalid blueprint', parsed.errors);
    const bp = parsed.blueprint;

    const slug = slugify(bp.project);
    let project = await prisma.project.findFirst({
      where: { workspaceId: body.workspaceId, slug, deletedAt: null },
    });

    const existing = project
      ? await gatherExisting(prisma, body.workspaceId, project.id)
      : emptyExisting();
    // Firewalls are workspace-scoped, so they exist independently of the project.
    if (!project) {
      const fws = await prisma.firewall.findMany({
        where: { workspaceId: body.workspaceId, deletedAt: null },
        select: { name: true },
      });
      for (const f of fws) existing.firewalls.add(f.name);
    }

    const plan = computeBlueprintPlan(bp, existing);
    if (body.dryRun) return { plan };

    if (!project) {
      project = await prisma.project.create({
        data: { workspaceId: body.workspaceId, name: bp.project, slug },
      });
    }
    const projectId = project.id;
    const applied: BlueprintPlanItem[] = [];
    const created = (item: BlueprintPlanItem) => applied.push(item);
    const isNew = (item: BlueprintPlanItem) => item.action === 'create';

    // --- Apps (create missing) — also remember addresses for LB target resolution.
    const appAddressByName = new Map<string, AppAddress>();
    for (const a of bp.apps) {
      const item = plan.find((p) => p.kind === 'app' && p.name === a.name)!;
      if (isNew(item)) {
        const appSlug = slugify(a.name);
        const repoUrl = a.source && /^https?:\/\//.test(a.source) ? a.source : null;
        const port = a.port ?? 3000;
        const createdApp = await prisma.app.create({
          data: {
            projectId,
            name: a.name,
            slug: appSlug,
            repoUrl,
            branch: a.branch ?? 'main',
            framework: (a.framework as AppFramework | undefined) ?? null,
            buildCommand: a.build ?? null,
            startCommand: a.start ?? null,
            port,
            cpu: a.resources?.cpu ?? 0.5,
            memoryMb: toMb(a.resources?.memory, 512),
            healthcheckPath: '/',
          },
        });
        await prisma.appEnvironment.create({
          data: { appId: createdApp.id, name: 'production', type: 'production' },
        });
        appAddressByName.set(a.name, { appId: createdApp.id, port });
        created(item);
      } else {
        const existingApp = await prisma.app.findFirst({
          where: { projectId, name: a.name, deletedAt: null },
          select: { id: true, port: true },
        });
        if (existingApp) appAddressByName.set(a.name, { appId: existingApp.id, port: existingApp.port });
      }
    }

    // --- Databases
    for (const d of bp.databases) {
      const item = plan.find((p) => p.kind === 'database' && p.name === d.name)!;
      if (!isNew(item)) continue;
      const nodeId = await pickNode(prisma, body.workspaceId, { region: d.region ?? bp.region });
      const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
      const password = generateApiToken().plaintext.replace('ys_', '');
      const database = await prisma.managedDatabase.create({
        data: {
          projectId,
          nodeId,
          name: d.name,
          engine: d.engine,
          version: d.version ?? '16',
          status: 'provisioning',
          region: node.region ?? d.region ?? bp.region ?? null,
          host: node.publicIp,
          port: allocatePort(`db-${projectId}-${d.name}`),
          passwordCipher: encryptor.encrypt(password),
          storageMb: toMb(d.storage, 10_240),
          cpu: d.resources?.cpu ?? 1,
          memoryMb: toMb(d.resources?.memory, 1024),
          createdById: req.user!.id,
        },
      });
      const job: DatabaseJob = { databaseId: database.id, action: 'provision', triggeredBy: req.user!.email };
      await queues.database.add(QUEUE_NAMES.DATABASE, job, { jobId: `db-${database.id}`, removeOnComplete: 200 });
      created(item);
    }

    // --- Buckets
    for (const b of bp.buckets) {
      const item = plan.find((p) => p.kind === 'bucket' && p.name === b.name)!;
      if (!isNew(item)) continue;
      const nodeId = await pickNode(prisma, body.workspaceId, { region: b.region ?? bp.region });
      const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
      const port = allocatePort(`obj-${projectId}-${b.name}`);
      const bucket = await prisma.storageBucket.create({
        data: {
          projectId,
          nodeId,
          name: b.name,
          status: 'provisioning',
          region: node.region ?? b.region ?? bp.region ?? null,
          endpoint: node.publicIp ? `http://${node.publicIp}:${port}` : null,
          isPublic: b.public ?? false,
          accessKey: generateApiToken().plaintext.replace('ys_', 'YS'),
          secretCipher: encryptor.encrypt(randomToken(24)),
          quotaMb: toMb(b.quota, 51_200),
          createdById: req.user!.id,
        },
      });
      const job: StorageJob = { bucketId: bucket.id, action: 'provision', triggeredBy: req.user!.email };
      await queues.storage.add(QUEUE_NAMES.STORAGE, job, { jobId: `obj-${bucket.id}`, removeOnComplete: 200 });
      created(item);
    }

    // --- Functions
    for (const f of bp.functions) {
      const item = plan.find((p) => p.kind === 'function' && p.name === f.name)!;
      if (!isNew(item)) continue;
      const nodeId = await pickNode(prisma, body.workspaceId, { region: bp.region });
      const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
      const repoUrl = f.source && /^https?:\/\//.test(f.source) ? f.source : null;
      const fn = await prisma.serverlessFunction.create({
        data: {
          projectId,
          nodeId,
          name: f.name,
          runtime: f.runtime,
          status: 'deploying',
          handler: f.handler ?? 'index.handler',
          region: node.region ?? bp.region ?? null,
          memoryMb: toMb(f.memory, 256),
          repoUrl,
          createdById: req.user!.id,
        },
      });
      const job: FunctionJob = { functionId: fn.id, action: 'deploy', triggeredBy: req.user!.email };
      await queues.fn.add(QUEUE_NAMES.FUNCTION, job, { jobId: `fn-${fn.id}`, removeOnComplete: 200 });
      created(item);
    }

    // --- Cron jobs
    for (const c of bp.cron) {
      const item = plan.find((p) => p.kind === 'cron' && p.name === c.name)!;
      if (!isNew(item)) continue;
      await prisma.cronJob.create({
        data: {
          projectId,
          name: c.name,
          schedule: c.schedule,
          image: c.image,
          command: c.command ?? null,
          status: 'active',
          region: bp.region ?? null,
          createdById: req.user!.id,
        },
      });
      created(item);
    }

    // --- Firewalls (workspace-scoped)
    for (const fw of bp.firewalls) {
      const item = plan.find((p) => p.kind === 'firewall' && p.name === fw.name)!;
      if (!isNew(item)) continue;
      await prisma.firewall.create({
        data: {
          workspaceId: body.workspaceId,
          name: fw.name,
          status: 'draft',
          defaultInbound: fw.defaultInbound,
          defaultOutbound: 'allow',
          nodeIds: fw.nodes ?? [],
          createdById: req.user!.id,
          rules: {
            create: fw.rules.map((r, position) => ({
              direction: 'inbound',
              action: r.allow ? 'allow' : 'deny',
              protocol: r.protocol,
              port: r.port ?? null,
              cidr: r.cidr,
              position,
            })),
          },
        },
      });
      created(item);
    }

    // --- Load balancers (project-scoped)
    for (const lb of bp.loadBalancers) {
      const item = plan.find((p) => p.kind === 'loadBalancer' && p.name === lb.name)!;
      if (!isNew(item)) continue;
      const appTargets: AppAddress[] = [];
      const explicit: string[] = [];
      for (const t of lb.targets) {
        const addr = appAddressByName.get(t);
        if (addr) appTargets.push(addr);
        else explicit.push(t);
      }
      const targets = resolveLbTargets(appTargets, explicit);
      if (targets.length === 0) continue;
      const nodeId = await pickNode(prisma, body.workspaceId, { region: bp.region });
      const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
      const created_lb = await prisma.loadBalancer.create({
        data: {
          projectId,
          nodeId,
          name: lb.name,
          status: 'provisioning',
          listenPort: lb.port,
          algorithm: (lb.algorithm as LBAlgorithm | undefined) ?? 'round_robin',
          region: node.region ?? bp.region ?? null,
          domain: lb.domain ?? null,
          autoHttps: lb.autoHttps ?? false,
          createdById: req.user!.id,
          targets: { create: targets },
        },
      });
      const job: LoadBalancerJob = { loadBalancerId: created_lb.id, action: 'provision' };
      await queues.loadBalancer.add(QUEUE_NAMES.LOADBALANCER, job, {
        jobId: `lb-${created_lb.id}`,
        removeOnComplete: 200,
      });
      created(item);
    }

    await audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'blueprint.apply',
      targetType: 'project',
      targetId: projectId,
      metadata: { project: bp.project, created: applied.length },
    });
    await realtime.publish(`workspace:${body.workspaceId}`, 'blueprint.applied', { projectId, applied: applied.length });

    return { plan, applied };
  });

  app.get('/projects/:pid/blueprint', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.PROJECT_VIEW);
    const blueprint = await exportBlueprint(prisma, project.workspaceId, pid, project.name);
    return { blueprint };
  });
}

/** Collect the names of resources that already exist in a project (for diffing). */
async function gatherExisting(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
): Promise<ExistingResources> {
  const [apps, databases, buckets, functions, cron, firewalls, loadBalancers] = await Promise.all([
    prisma.app.findMany({ where: { projectId, deletedAt: null }, select: { name: true } }),
    prisma.managedDatabase.findMany({ where: { projectId, deletedAt: null }, select: { name: true } }),
    prisma.storageBucket.findMany({ where: { projectId, deletedAt: null }, select: { name: true } }),
    prisma.serverlessFunction.findMany({ where: { projectId, deletedAt: null }, select: { name: true } }),
    prisma.cronJob.findMany({ where: { projectId, deletedAt: null }, select: { name: true } }),
    prisma.firewall.findMany({ where: { workspaceId, deletedAt: null }, select: { name: true } }),
    prisma.loadBalancer.findMany({ where: { projectId, deletedAt: null }, select: { name: true } }),
  ]);
  return {
    apps: new Set(apps.map((r) => r.name)),
    databases: new Set(databases.map((r) => r.name)),
    buckets: new Set(buckets.map((r) => r.name)),
    functions: new Set(functions.map((r) => r.name)),
    cron: new Set(cron.map((r) => r.name)),
    firewalls: new Set(firewalls.map((r) => r.name)),
    loadBalancers: new Set(loadBalancers.map((r) => r.name)),
  };
}

/** Serialize a project's current resources back into a blueprint object. */
async function exportBlueprint(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  projectName: string,
): Promise<Blueprint> {
  const [apps, databases, buckets, functions, cron, firewalls, loadBalancers] = await Promise.all([
    prisma.app.findMany({ where: { projectId, deletedAt: null }, include: { domains: true } }),
    prisma.managedDatabase.findMany({ where: { projectId, deletedAt: null } }),
    prisma.storageBucket.findMany({ where: { projectId, deletedAt: null } }),
    prisma.serverlessFunction.findMany({ where: { projectId, deletedAt: null } }),
    prisma.cronJob.findMany({ where: { projectId, deletedAt: null } }),
    prisma.firewall.findMany({ where: { workspaceId, deletedAt: null }, include: { rules: true } }),
    prisma.loadBalancer.findMany({ where: { projectId, deletedAt: null }, include: { targets: true } }),
  ]);

  return {
    version: 1,
    project: projectName,
    apps: apps.map((a) => ({
      name: a.name,
      source: a.repoUrl ?? undefined,
      branch: a.branch,
      framework: (a.framework as Blueprint['apps'][number]['framework']) ?? undefined,
      build: a.buildCommand ?? undefined,
      start: a.startCommand ?? undefined,
      port: a.port,
      resources: { cpu: a.cpu, memory: a.memoryMb },
      domains: a.domains.length ? a.domains.map((d) => d.hostname) : undefined,
    })),
    databases: databases.map((d) => ({
      name: d.name,
      engine: d.engine as Blueprint['databases'][number]['engine'],
      version: d.version,
      storage: d.storageMb,
      resources: { cpu: d.cpu, memory: d.memoryMb },
      region: d.region ?? undefined,
    })),
    buckets: buckets.map((b) => ({
      name: b.name,
      public: b.isPublic,
      quota: b.quotaMb,
      region: b.region ?? undefined,
    })),
    functions: functions.map((f) => ({
      name: f.name,
      runtime: f.runtime as Blueprint['functions'][number]['runtime'],
      handler: f.handler,
      source: f.repoUrl ?? undefined,
      memory: f.memoryMb,
    })),
    cron: cron.map((c) => ({
      name: c.name,
      schedule: c.schedule,
      image: c.image,
      command: c.command ?? undefined,
    })),
    firewalls: firewalls.map((fw) => ({
      name: fw.name,
      nodes: fw.nodeIds,
      defaultInbound: fw.defaultInbound as 'allow' | 'deny',
      rules: fw.rules
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          allow: r.action === 'allow',
          protocol: r.protocol as 'tcp' | 'udp' | 'icmp' | 'any',
          port: r.port ?? undefined,
          cidr: r.cidr,
        })),
    })),
    loadBalancers: loadBalancers.map((lb) => ({
      name: lb.name,
      port: lb.listenPort,
      algorithm: lb.algorithm as Blueprint['loadBalancers'][number]['algorithm'],
      targets: lb.targets.map((t) => t.address),
      domain: lb.domain ?? undefined,
      autoHttps: lb.autoHttps,
    })),
  };
}
