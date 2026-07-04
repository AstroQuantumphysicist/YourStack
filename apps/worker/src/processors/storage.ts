import type { Job } from 'bullmq';
import { CommandType, storageJobSchema, SSE_CHANNELS } from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';
import { allocatePort } from '../lib/ports.js';

/** Object-storage (MinIO) processor: dispatch provision/remove to the node. */
export async function processStorage(ctx: WorkerContext, job: Job): Promise<void> {
  const data = storageJobSchema.parse(job.data);
  const { prisma } = ctx;
  const bucket = await prisma.storageBucket.findUnique({ where: { id: data.bucketId } });
  if (!bucket || !bucket.nodeId) return;
  const containerName = bucket.containerName ?? `yourstack-obj-${bucket.id}`;
  if (!bucket.containerName) {
    await prisma.storageBucket.update({ where: { id: bucket.id }, data: { containerName } });
  }

  if (data.action === 'provision') {
    const secretKey = bucket.secretCipher ? safeDecrypt(ctx, bucket.secretCipher) : '';
    const port = allocatePort(`obj-${bucket.id}`);
    const consolePort = allocatePort(`obj-console-${bucket.id}`);
    await createSignedCommand(ctx, {
      nodeId: bucket.nodeId,
      appId: bucket.id,
      timeoutMs: 8 * 60_000,
      payload: {
        type: CommandType.PROVISION_STORAGE,
        spec: {
          bucketId: bucket.id,
          bucketName: bucket.name,
          containerName,
          accessKey: bucket.accessKey ?? 'yourstack',
          secretKey,
          quotaMb: bucket.quotaMb,
          isPublic: bucket.isPublic,
          port,
          consolePort,
        },
      },
    });
  } else if (data.action === 'remove') {
    await createSignedCommand(ctx, {
      nodeId: bucket.nodeId,
      appId: bucket.id,
      payload: { type: CommandType.REMOVE_STORAGE, spec: { bucketId: bucket.id, containerName, removeVolume: true } },
    });
  }
  await publish(ctx, SSE_CHANNELS.bucket(bucket.id), 'bucket.status', { bucketId: bucket.id, status: bucket.status });
}

function safeDecrypt(ctx: WorkerContext, cipher: string): string {
  try {
    return ctx.encryptor.decrypt(cipher);
  } catch {
    return '';
  }
}
