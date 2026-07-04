import type { Job } from 'bullmq';
import { CommandType, databaseJobSchema, SSE_CHANNELS } from '@yourstack/shared';
import { publish, type WorkerContext } from '../context.js';
import { createSignedCommand } from '../lib/command.js';

const DEFAULT_VERSION: Record<string, string> = {
  postgres: '16',
  mysql: '8',
  redis: '7',
  mongodb: '7',
};

/**
 * Managed-database processor: turns a DatabaseJob into a signed node command.
 * The agent runs the engine container; the API finalizes status on report-back.
 */
export async function processDatabase(ctx: WorkerContext, job: Job): Promise<void> {
  const data = databaseJobSchema.parse(job.data);
  const { prisma } = ctx;
  const db = await prisma.managedDatabase.findUnique({ where: { id: data.databaseId } });
  if (!db || !db.nodeId) return;
  const containerName = db.containerName ?? `yourstack-db-${db.id}`;

  if (!db.containerName) {
    await prisma.managedDatabase.update({ where: { id: db.id }, data: { containerName } });
  }

  if (data.action === 'provision') {
    const password = db.passwordCipher ? safeDecrypt(ctx, db.passwordCipher) : '';
    await createSignedCommand(ctx, {
      nodeId: db.nodeId,
      appId: db.id,
      timeoutMs: 10 * 60_000,
      payload: {
        type: CommandType.PROVISION_DATABASE,
        spec: {
          databaseId: db.id,
          engine: db.engine,
          version: db.version || DEFAULT_VERSION[db.engine] || 'latest',
          containerName,
          dbName: db.name.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'app',
          username: db.username,
          password,
          storageMb: db.storageMb,
          resources: { cpu: db.cpu, memoryMb: db.memoryMb },
          port: db.port ?? 5432,
          networkName: `yourstack_db_${db.id}`,
        },
      },
    });
  } else if (data.action === 'stop') {
    await createSignedCommand(ctx, {
      nodeId: db.nodeId,
      appId: db.id,
      payload: { type: CommandType.STOP_DATABASE, spec: { databaseId: db.id, containerName } },
    });
  } else if (data.action === 'remove') {
    await createSignedCommand(ctx, {
      nodeId: db.nodeId,
      appId: db.id,
      payload: { type: CommandType.REMOVE_DATABASE, spec: { databaseId: db.id, containerName, removeVolume: true } },
    });
  } else if (data.action === 'backup') {
    await prisma.managedDatabase.update({ where: { id: db.id }, data: { status: 'backing_up' } });
    await createSignedCommand(ctx, {
      nodeId: db.nodeId,
      appId: db.id,
      payload: { type: CommandType.BACKUP_DATABASE, spec: { databaseId: db.id, containerName, engine: db.engine } },
    });
  }

  await publish(ctx, SSE_CHANNELS.database(db.id), 'database.status', { databaseId: db.id, status: db.status });
}

function safeDecrypt(ctx: WorkerContext, cipher: string): string {
  try {
    return ctx.encryptor.decrypt(cipher);
  } catch {
    return '';
  }
}
