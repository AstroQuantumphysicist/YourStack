import type { FastifyInstance } from 'fastify';
import {
  createBucketSchema,
  Permission,
  QUEUE_NAMES,
  SSE_CHANNELS,
  type StorageJob,
} from '@yourstack/shared';
import { generateApiToken, randomToken } from '@yourstack/security';
import { requirePermission } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { toBucketDTO } from '../lib/dto.js';
import { pickNode, allocatePort } from '../services/placement.service.js';

async function bucketWithWorkspace(prisma: import('@yourstack/db').PrismaClient, id: string) {
  const bucket = await prisma.storageBucket.findFirst({
    where: { id, deletedAt: null },
    include: { project: true },
  });
  if (!bucket) throw Errors.notFound('Bucket not found');
  return { bucket, workspaceId: bucket.project.workspaceId };
}

export default async function storageRoutes(app: FastifyInstance) {
  const { prisma, queues, encryptor, audit, realtime } = app.ctx;

  app.get('/projects/:pid/buckets', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.STORAGE_VIEW);
    const buckets = await prisma.storageBucket.findMany({
      where: { projectId: pid, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { buckets: buckets.map(toBucketDTO) };
  });

  app.post('/projects/:pid/buckets', async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null } });
    if (!project) throw Errors.notFound('Project not found');
    await requirePermission(prisma, req, project.workspaceId, Permission.STORAGE_WRITE);
    const body = parse(createBucketSchema.omit({ projectId: true }), req.body);
    if (await prisma.storageBucket.findFirst({ where: { projectId: pid, name: body.name, deletedAt: null } })) {
      throw Errors.conflict('A bucket with that name already exists in this project');
    }

    const nodeId = await pickNode(prisma, project.workspaceId, { nodeId: body.nodeId, region: body.region });
    const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    const port = allocatePort(`obj-${pid}-${body.name}`);
    const accessKey = generateApiToken().plaintext.replace('ys_', 'YS');
    const secretKey = randomToken(24);

    const bucket = await prisma.storageBucket.create({
      data: {
        projectId: pid,
        nodeId,
        name: body.name,
        status: 'provisioning',
        region: node.region ?? body.region ?? null,
        endpoint: node.publicIp ? `http://${node.publicIp}:${port}` : null,
        isPublic: body.isPublic,
        accessKey,
        secretCipher: encryptor.encrypt(secretKey),
        quotaMb: body.quotaMb,
        createdById: req.user!.id,
      },
    });

    const job: StorageJob = { bucketId: bucket.id, action: 'provision', triggeredBy: req.user!.email };
    await queues.storage.add(QUEUE_NAMES.STORAGE, job, { jobId: `obj-${bucket.id}`, removeOnComplete: 200 });
    await realtime.publish(SSE_CHANNELS.workspace(project.workspaceId), 'bucket.created', { bucketId: bucket.id });
    await audit({
      workspaceId: project.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'bucket.create',
      targetType: 'bucket',
      targetId: bucket.id,
    });
    return { bucket: toBucketDTO(bucket) };
  });

  app.get('/buckets/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { bucket, workspaceId } = await bucketWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.STORAGE_VIEW);
    return { bucket: toBucketDTO(bucket) };
  });

  app.get('/buckets/:id/credentials', async (req) => {
    const { id } = req.params as { id: string };
    const { bucket, workspaceId } = await bucketWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.STORAGE_WRITE);
    let secretKey: string | null = null;
    try {
      secretKey = bucket.secretCipher ? encryptor.decrypt(bucket.secretCipher) : null;
    } catch {
      secretKey = null;
    }
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'bucket.reveal_credentials',
      targetType: 'bucket',
      targetId: id,
    });
    return { endpoint: bucket.endpoint, region: bucket.region ?? 'us-east-1', accessKey: bucket.accessKey, secretKey };
  });

  app.delete('/buckets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { bucket, workspaceId } = await bucketWithWorkspace(prisma, id);
    await requirePermission(prisma, req, workspaceId, Permission.STORAGE_DELETE);
    await prisma.storageBucket.update({ where: { id }, data: { deletedAt: new Date() } });
    const job: StorageJob = { bucketId: bucket.id, action: 'remove', triggeredBy: req.user!.email };
    await queues.storage.add(QUEUE_NAMES.STORAGE, job, { removeOnComplete: 200 });
    await audit({
      workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'bucket.delete',
      targetType: 'bucket',
      targetId: id,
    });
    reply.status(204).send();
  });
}
