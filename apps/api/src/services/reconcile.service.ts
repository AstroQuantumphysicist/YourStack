import type { PrismaClient } from '@yourstack/db';
import { NODE_RECONCILE_COOLDOWN_MS, SSE_CHANNELS } from '@yourstack/shared';
import type { Queue } from 'bullmq';
import type { RealtimeHub } from '../realtime/hub.js';
import { triggerDeployment } from './deployment.service.js';
import { logger } from '../logger.js';

/**
 * Apps whose status implies the control plane expects a running container. Only
 * these are reconciled against the node's reported running set — an `idle`,
 * `stopped`, or `failed` app is intentionally not running and left alone, and a
 * `building`/`deploying` app is mid-flight and handled by the deploy pipeline.
 */
const EXPECTED_RUNNING = new Set(['running', 'unreachable']);

export interface ReconcileInput {
  nodeId: string;
  workspaceId: string;
  /** App ids the agent reports as currently running on the node. */
  reportedRunningAppIds: string[];
  /** True when this heartbeat is the node's first after being non-online. */
  cameBackOnline: boolean;
}

export interface ReconcileResult {
  recovered: number; // apps confirmed back to running
  unreachable: number; // apps flagged not-running
  redeployed: number; // auto-heal deployments enqueued
}

/**
 * Reconcile a node's apps against what the agent reports actually running.
 *
 *  - An app reported running that the DB thinks isn't → mark `running` (clears
 *    an earlier `unreachable`).
 *  - An expected-running app NOT reported → mark `unreachable`.
 *  - When the node has just reconnected (and past the per-node cooldown),
 *    auto-heal by redeploying the still-missing expected-running apps.
 *
 * Best-effort and defensive: never throws into the heartbeat path.
 */
export async function reconcileNodeApps(
  prisma: PrismaClient,
  realtime: RealtimeHub,
  deployQueue: Queue,
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { recovered: 0, unreachable: 0, redeployed: 0 };
  const reported = new Set(input.reportedRunningAppIds);

  const apps = await prisma.app.findMany({
    where: { nodeId: input.nodeId, deletedAt: null },
    select: { id: true, status: true },
  });

  const emit = async (appId: string, status: string) => {
    await realtime.publish(SSE_CHANNELS.app(appId), 'app.status', { appId, status });
    await realtime.publish(SSE_CHANNELS.workspace(input.workspaceId), 'app.status', { appId, status });
  };

  const missing: string[] = [];
  for (const app of apps) {
    const isReported = reported.has(app.id);
    if (isReported) {
      // Confirmed running. Clear any stale non-running status.
      if (app.status !== 'running') {
        await prisma.app.update({ where: { id: app.id }, data: { status: 'running' } });
        await emit(app.id, 'running');
        result.recovered += 1;
      }
      continue;
    }
    // Not reported running. Only act if we expected it to be running.
    if (EXPECTED_RUNNING.has(app.status)) {
      if (app.status !== 'unreachable') {
        await prisma.app.update({ where: { id: app.id }, data: { status: 'unreachable' } });
        await emit(app.id, 'unreachable');
        result.unreachable += 1;
      }
      missing.push(app.id);
    }
  }

  // Auto-heal only on reconnect, and only once per cooldown window per node.
  if (input.cameBackOnline && missing.length > 0) {
    const node = await prisma.node.findUnique({
      where: { id: input.nodeId },
      select: { lastReconcileAt: true, disabled: true },
    });
    const now = Date.now();
    const cool = node?.lastReconcileAt ? now - node.lastReconcileAt.getTime() : Infinity;
    if (node && !node.disabled && cool >= NODE_RECONCILE_COOLDOWN_MS) {
      await prisma.node.update({ where: { id: input.nodeId }, data: { lastReconcileAt: new Date() } });
      for (const appId of missing) {
        try {
          await triggerDeployment(prisma, deployQueue, realtime, {
            appId,
            triggeredBy: 'reconcile',
            reason: 'auto-heal: node reconnected, app was not running',
            system: true,
          });
          result.redeployed += 1;
        } catch (err) {
          logger.warn({ err, appId, nodeId: input.nodeId }, 'auto-heal redeploy failed');
        }
      }
    }
  }

  if (result.recovered || result.unreachable || result.redeployed) {
    logger.info({ nodeId: input.nodeId, ...result }, 'reconciled node apps');
  }
  return result;
}
