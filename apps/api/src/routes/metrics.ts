import type { FastifyInstance } from 'fastify';

/**
 * Minimal Prometheus-compatible metrics endpoint. Exposes process metrics plus
 * a few platform gauges. Kept dependency-free (no prom-client) to stay light.
 */
export default async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_req, reply) => {
    const mem = process.memoryUsage();
    const [nodes, onlineNodes, runningApps, queuedCommands] = await Promise.all([
      app.ctx.prisma.node.count({ where: { deletedAt: null } }),
      app.ctx.prisma.node.count({ where: { deletedAt: null, status: 'online' } }),
      app.ctx.prisma.app.count({ where: { deletedAt: null, status: 'running' } }),
      app.ctx.prisma.nodeCommand.count({ where: { status: 'queued' } }),
    ]).catch(() => [0, 0, 0, 0]);

    const lines = [
      '# HELP yourstack_process_resident_memory_bytes Resident memory in bytes',
      '# TYPE yourstack_process_resident_memory_bytes gauge',
      `yourstack_process_resident_memory_bytes ${mem.rss}`,
      '# HELP yourstack_process_uptime_seconds Process uptime',
      '# TYPE yourstack_process_uptime_seconds gauge',
      `yourstack_process_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP yourstack_nodes_total Registered nodes',
      '# TYPE yourstack_nodes_total gauge',
      `yourstack_nodes_total ${nodes}`,
      '# HELP yourstack_nodes_online Online nodes',
      '# TYPE yourstack_nodes_online gauge',
      `yourstack_nodes_online ${onlineNodes}`,
      '# HELP yourstack_apps_running Running apps',
      '# TYPE yourstack_apps_running gauge',
      `yourstack_apps_running ${runningApps}`,
      '# HELP yourstack_commands_queued Queued node commands',
      '# TYPE yourstack_commands_queued gauge',
      `yourstack_commands_queued ${queuedCommands}`,
    ];
    reply.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
}
