import type { PrismaClient, Project } from '@yourstack/db';
import type { Encryptor } from '@yourstack/security';
import { generateApiToken, randomToken } from '@yourstack/security';
import {
  DatabaseEngine,
  QUEUE_NAMES,
  SSE_CHANNELS,
  TemplateKind,
  type DatabaseEngine as DatabaseEngineType,
  type DatabaseJob,
  type DeployTemplateInput,
  type TemplateVariableDTO,
} from '@yourstack/shared';
import type { Queue } from 'bullmq';
import type { RealtimeHub } from '../realtime/hub.js';
import { Errors } from '../lib/errors.js';
import { slugify } from '../lib/util.js';
import { allocatePort, pickNode } from './placement.service.js';
import { triggerDeployment } from './deployment.service.js';

/**
 * Declarative marketplace template spec (stored as JSON on Template.spec). The
 * shape is validated defensively here rather than in Prisma, so a malformed
 * catalog entry degrades gracefully instead of crashing the deploy path.
 */
export interface TemplateVariableSpec {
  key: string;
  label?: string;
  default?: string | null;
  required?: boolean;
  secret?: boolean;
  /** When set, a value is generated server-side if the user did not supply one. */
  generate?: 'password' | 'token';
}

export interface TemplateSpec {
  image?: string;
  port?: number;
  env?: Record<string, string>;
  /** Database templates: engine + version (falls back to the slug). */
  engine?: string;
  version?: string;
  storageMb?: number;
  resources?: { cpu?: number; memoryMb?: number };
  variables?: TemplateVariableSpec[];
}

/** Default engine version per database engine. */
const ENGINE_DEFAULT_VERSION: Record<DatabaseEngineType, string> = {
  postgres: '16',
  mysql: '8',
  redis: '7',
  mongodb: '7',
};

/** Safely coerce the stored JSON spec into a typed shape. */
export function parseTemplateSpec(raw: unknown): TemplateSpec {
  if (!raw || typeof raw !== 'object') return {};
  return raw as TemplateSpec;
}

/** Project a template spec's variables to their public (non-secret) DTO form. */
export function templateVariableDTOs(raw: unknown): TemplateVariableDTO[] {
  const spec = parseTemplateSpec(raw);
  return (spec.variables ?? []).map((v) => ({
    key: v.key,
    label: v.label ?? v.key,
    // Never expose a value for a secret/generated variable.
    default: v.secret || v.generate ? null : v.default ?? null,
    required: v.required ?? false,
    secret: Boolean(v.secret || v.generate),
  }));
}

/**
 * Determine the database engine a template provisions. Prefers an explicit
 * `spec.engine`, then falls back to matching a known engine token in the slug
 * (e.g. "postgres-16", "redis-stack"). Pure + unit-tested.
 */
export function engineFromSlug(slug: string, spec: TemplateSpec = {}): DatabaseEngineType | null {
  const engines = Object.values(DatabaseEngine);
  const explicit = spec.engine?.toLowerCase();
  if (explicit && (engines as string[]).includes(explicit)) {
    return explicit as DatabaseEngineType;
  }
  const haystack = slug.toLowerCase();
  // Alias mapping for common naming (e.g. "mongo" → "mongodb", "pg" → "postgres").
  const aliases: Array<[RegExp, DatabaseEngineType]> = [
    [/postgres|postgresql|\bpg\b/, DatabaseEngine.POSTGRES],
    [/mysql|mariadb/, DatabaseEngine.MYSQL],
    [/redis|valkey/, DatabaseEngine.REDIS],
    [/mongo/, DatabaseEngine.MONGODB],
  ];
  for (const [re, engine] of aliases) {
    if (re.test(haystack)) return engine;
  }
  return null;
}

export interface ResolvedVariables {
  values: Record<string, string>;
  /** Keys whose values are secret (generated or flagged secret). */
  secretKeys: Set<string>;
}

/**
 * Resolve template variables: user overrides win, otherwise generate (for
 * generate:'password'|'token') or fall back to the declared default. Enforces
 * required variables. Pure aside from crypto-random generation.
 */
export function resolveTemplateVariables(
  spec: TemplateSpec,
  overrides: Record<string, string>,
): ResolvedVariables {
  const values: Record<string, string> = {};
  const secretKeys = new Set<string>();
  for (const v of spec.variables ?? []) {
    const provided = overrides[v.key];
    let value: string | undefined = provided;
    if (value == null || value === '') {
      if (v.generate === 'password') {
        value = generateApiToken().plaintext.replace('ys_', '');
      } else if (v.generate === 'token') {
        value = randomToken(24);
      } else {
        value = v.default ?? undefined;
      }
    }
    if ((value == null || value === '') && v.required) {
      throw Errors.badRequest(`Missing required template variable: ${v.key}`);
    }
    if (value != null) {
      values[v.key] = value;
      if (v.secret || v.generate) secretKeys.add(v.key);
    }
  }
  return { values, secretKeys };
}

export interface DeployTemplateDeps {
  prisma: PrismaClient;
  encryptor: Encryptor;
  queues: { database: Queue; deploy: Queue };
  realtime: RealtimeHub;
}

export interface DeployTemplateParams {
  template: {
    slug: string;
    name: string;
    kind: string;
    image: string | null;
    spec: unknown;
  };
  project: Project;
  input: DeployTemplateInput;
  user: { id: string; email: string };
}

export interface DeployTemplateResult {
  kind: string;
  id: string;
  resourceType: 'database' | 'app';
}

/**
 * Translate a marketplace template into a concrete managed resource. Database
 * templates provision a ManagedDatabase; everything else deploys an App from the
 * template's container image. Resolved variables + template env are injected as
 * secrets scoped to the created resource.
 */
export async function deployTemplate(
  deps: DeployTemplateDeps,
  params: DeployTemplateParams,
): Promise<DeployTemplateResult> {
  const { prisma, encryptor, queues, realtime } = deps;
  const { template, project, input, user } = params;
  const spec = parseTemplateSpec(template.spec);
  const resolved = resolveTemplateVariables(spec, input.variables);
  const envAndVars: Record<string, string> = { ...(spec.env ?? {}), ...resolved.values };
  const name = input.name ?? template.name;

  const nodeId = await pickNode(prisma, project.workspaceId, {
    nodeId: input.nodeId,
    region: input.region,
  });
  const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });

  const engine = template.kind === TemplateKind.DATABASE ? engineFromSlug(template.slug, spec) : null;

  if (template.kind === TemplateKind.DATABASE) {
    const resolvedEngine = engine ?? DatabaseEngine.POSTGRES;
    const password = generateApiToken().plaintext.replace('ys_', '');
    const hostPort = allocatePort(`tpl-db-${project.id}-${slugify(name)}`);

    const database = await prisma.managedDatabase.create({
      data: {
        projectId: project.id,
        nodeId,
        name,
        engine: resolvedEngine,
        version: spec.version ?? ENGINE_DEFAULT_VERSION[resolvedEngine],
        status: 'provisioning',
        region: node.region ?? input.region ?? null,
        host: node.publicIp,
        port: hostPort,
        passwordCipher: encryptor.encrypt(password),
        storageMb: spec.storageMb ?? 10_240,
        cpu: spec.resources?.cpu ?? 1,
        memoryMb: spec.resources?.memoryMb ?? 1024,
        createdById: user.id,
      },
    });

    // Surface template env/vars as project-scoped secrets (best-effort).
    await injectSecrets(prisma, encryptor, {
      scope: 'project',
      projectId: project.id,
      createdById: user.id,
      entries: envAndVars,
    });

    const job: DatabaseJob = { databaseId: database.id, action: 'provision', triggeredBy: user.email };
    await queues.database.add(QUEUE_NAMES.DATABASE, job, {
      jobId: `db-${database.id}`,
      removeOnComplete: 200,
    });
    await realtime.publish(SSE_CHANNELS.workspace(project.workspaceId), 'database.created', {
      databaseId: database.id,
    });

    return { kind: template.kind, id: database.id, resourceType: 'database' };
  }

  // App-style template: deploy the template's container image as an App.
  const image = spec.image ?? template.image;
  if (!image) throw Errors.badRequest('Template has no container image to deploy');

  const slug = await uniqueAppSlug(prisma, project.id, name);
  const app = await prisma.app.create({
    data: {
      projectId: project.id,
      name,
      slug,
      // A bare image ref (e.g. "grafana/grafana:latest") — the worker resolves
      // this as an image source rather than a git build.
      repoUrl: image,
      branch: 'main',
      framework: 'dockerfile',
      port: spec.port ?? 3000,
      cpu: spec.resources?.cpu ?? 0.5,
      memoryMb: spec.resources?.memoryMb ?? 512,
      healthcheckPath: '/',
      nodeId,
    },
  });
  await prisma.appEnvironment.create({
    data: { appId: app.id, name: 'production', type: 'production' },
  });

  await injectSecrets(prisma, encryptor, {
    scope: 'app',
    appId: app.id,
    createdById: user.id,
    entries: envAndVars,
  });

  await triggerDeployment(prisma, queues.deploy, realtime, {
    appId: app.id,
    triggeredBy: user.email,
    triggeredById: user.id,
    reason: `Deploy template ${template.slug}`,
  });

  return { kind: template.kind, id: app.id, resourceType: 'app' };
}

/** Bulk-create secrets for a resource, skipping any key collisions. */
async function injectSecrets(
  prisma: PrismaClient,
  encryptor: Encryptor,
  opts: {
    scope: 'project' | 'app';
    projectId?: string;
    appId?: string;
    createdById: string;
    entries: Record<string, string>;
  },
): Promise<void> {
  const rows = Object.entries(opts.entries).map(([key, value]) => ({
    scope: opts.scope,
    key,
    ciphertext: encryptor.encrypt(value),
    lastFour: value.slice(-4),
    projectId: opts.projectId ?? null,
    appId: opts.appId ?? null,
    createdById: opts.createdById,
  }));
  if (rows.length === 0) return;
  await prisma.secret.createMany({ data: rows, skipDuplicates: true });
}

/** Ensure the derived app slug is unique within the project. */
async function uniqueAppSlug(prisma: PrismaClient, projectId: string, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const existing = await prisma.app.findUnique({
      where: { projectId_slug: { projectId, slug } },
    });
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}
