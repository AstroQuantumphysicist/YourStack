import type { FastifyInstance } from 'fastify';
import {
  createDatabaseSchema,
  Permission,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type DatabaseJob,
} from '@yourstack/shared';
import { generateApiToken } from '@yourstack/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toDatabaseDTO } from '../lib/dto.js';
import { pickNode, allocatePort } from '../services/placement.service.js';

const DEFAULT_INTERNAL_PORT: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
};

async function dbWithWorkspace(prisma: import('@yourstack/db').PrismaClient, id: string) {
  const db = await prisma.managedDatabase.findFirst({
    where: { id, deletedAt: null },
    include: { project: true },
  });
  if (!db) throw Errors.notFound('Database not found');
  return { db, workspaceId: db.project.workspaceId };
}

export default async function databaseRoutes(app: FastifyInstance) {
  const { prisma, queues, encryptor, audit, realtime } = app.ctx;

  app.get('/projects/:pid/databases', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.DATA_VIEW);
    const databases = await prisma.managedDatabase.findMany({
      where: { projectId: pid, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { databases: databases.map(toDatabaseDTO) };
  });

  app.post('/projects/:pid/databases', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.DATA_WRITE);
    const body = parse(createDatabaseSchema.omit({ projectId: true }), req.body);

    const nodeId = await pickNode(prisma, project.workspaceId, {
      nodeId: body.nodeId,
      region: body.region,
    });
    const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    const password = generateApiToken().plaintext.replace('ys_', '');
    const hostPort = allocatePort(`db-${pid}-${body.name}`);

    const database = await prisma.managedDatabase.create({
      data: {
        projectId: pid,
        nodeId,
        name: body.name,
        engine: body.engine,
        version: body.version,
        status: 'provisioning',
        region: node.region ?? body.region ?? null,
        host: node.publicIp,
        port: hostPort,
        passwordCipher: encryptor.encrypt(password),
        storageMb: body.storageMb,
        cpu: body.cpu,
        memoryMb: body.memoryMb,
        createdById: req.user!.id,
      },
    });

    const job: DatabaseJob = { databaseId: database.id, action: 'provision', triggeredBy: req.user!.email };
    await queues.database.add(QUEUE_NAMES.DATABASE, job, { jobId: `db-${database.id}`, removeOnComplete: 200 });
    await realtime.publish(SSE_CHANNELS.workspace(project.workspaceId), 'database.created', { databaseId: database.id });
    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'database.create',
      targetType: 'database',
      targetId: database.id,
      metadata: { engine: body.engine },
    });
    return { database: toDatabaseDTO(database) };
  });

  app.get('/databases/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { db, workspaceId } = await dbWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.DATA_VIEW);
    return { database: toDatabaseDTO(db) };
  });

  // Reveal connection credentials (audited, DATA_WRITE).
  app.get('/databases/:id/credentials', async (req) => {
    const { id } = req.params as { id: string };
    const { db, workspaceId } = await dbWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.DATA_WRITE);
    const password = db.passwordCipher ? safeDecrypt(encryptor, db.passwordCipher) : null;
    const host = db.host ?? 'pending';
    const internal = DEFAULT_INTERNAL_PORT[db.engine] ?? db.port ?? 0;
    const connectionString = buildConnString(db.engine, db.username, password ?? '', host, db.port ?? internal, db.name);
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'database.reveal_credentials',
      targetType: 'database',
      targetId: id,
    });
    return { username: db.username, password, host, port: db.port, connectionString };
  });

  for (const action of ['stop', 'start', 'backup'] as const) {
    app.post(`/databases/:id/${action}`, async (req) => {
      const { id } = req.params as { id: string };
      const { db, workspaceId } = await dbWithWorkspace(prisma, id);
      await requirePermission(prisma, req, workspaceId, Permission.DATA_WRITE);
      const jobAction = action === 'start' ? 'provision' : action;
      const job: DatabaseJob = { databaseId: db.id, action: jobAction, triggeredBy: req.user!.email };
      await queues.database.add(QUEUE_NAMES.DATABASE, job, { removeOnComplete: 200 });
      return { ok: true, action };
    });
  }

  app.delete('/databases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { db, workspaceId } = await dbWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.DATA_DELETE);
    await prisma.managedDatabase.update({ where: { id }, data: { deletedAt: new Date(), status: 'stopped' } });
    const job: DatabaseJob = { databaseId: db.id, action: 'remove', triggeredBy: req.user!.email };
    await queues.database.add(QUEUE_NAMES.DATABASE, job, { removeOnComplete: 200 });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'database.delete',
      targetType: 'database',
      targetId: id,
    });
    reply.status(204).send();
  });
}

function buildConnString(
  engine: string,
  user: string,
  pass: string,
  host: string,
  port: number,
  db: string,
): string {
  switch (engine) {
    case 'postgres':
      return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
    case 'mysql':
      return `mysql://${user}:${pass}@${host}:${port}/${db}`;
    case 'mongodb':
      return `mongodb://${user}:${pass}@${host}:${port}/${db}`;
    case 'redis':
      return `redis://:${pass}@${host}:${port}`;
    default:
      return `${engine}://${host}:${port}`;
  }
}

function safeDecrypt(enc: import('@yourstack/security').Encryptor, cipher: string): string | null {
  try {
    return enc.decrypt(cipher);
  } catch {
    return null;
  }
}
