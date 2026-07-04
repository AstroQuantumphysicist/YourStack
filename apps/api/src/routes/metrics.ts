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
      '# HELP noderail_process_resident_memory_bytes Resident memory in bytes',
      '# TYPE noderail_process_resident_memory_bytes gauge',
      `noderail_process_resident_memory_bytes ${mem.rss}`,
      '# HELP noderail_process_uptime_seconds Process uptime',
      '# TYPE noderail_process_uptime_seconds gauge',
      `noderail_process_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP noderail_nodes_total Registered nodes',
      '# TYPE noderail_nodes_total gauge',
      `noderail_nodes_total ${nodes}`,
      '# HELP noderail_nodes_online Online nodes',
      '# TYPE noderail_nodes_online gauge',
      `noderail_nodes_online ${onlineNodes}`,
      '# HELP noderail_apps_running Running apps',
      '# TYPE noderail_apps_running gauge',
      `noderail_apps_running ${runningApps}`,
      '# HELP noderail_commands_queued Queued node commands',
      '# TYPE noderail_commands_queued gauge',
      `noderail_commands_queued ${queuedCommands}`,
    ];
    reply.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
}
