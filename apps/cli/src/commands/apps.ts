import { Command } from 'commander';
import pc from 'picocolors';
import { requireClient, resolveProjectId, type GlobalFlags } from '../lib/context.js';
import { info, printJson, renderTable, statusColor, timeAgo } from '../lib/output.js';

export function registerApps(program: Command): void {
  const apps = program.command('apps').description('Manage apps');

  apps
    .command('list')
    .alias('ls')
    .description('List apps in the current (or given) project')
    .option('-p, --project <id>', 'Project id (defaults to the linked project)')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { project?: string; json?: boolean }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      const { client } = await requireClient(flags);
      const projectId = await resolveProjectId(opts.project);
      const { apps: list } = await client.listApps(projectId);

      if (opts.json) {
        printJson(list);
        return;
      }

      info(
        renderTable(list, [
          { header: 'NAME', value: (a) => a.name },
          { header: 'STATUS', value: (a) => statusColor(a.status) },
          { header: 'FRAMEWORK', value: (a) => a.framework ?? pc.dim('—') },
          { header: 'BRANCH', value: (a) => a.branch },
          { header: 'PORT', value: (a) => String(a.port) },
          { header: 'UPDATED', value: (a) => timeAgo(a.updatedAt) },
          { header: 'ID', value: (a) => pc.dim(a.id) },
        ]),
      );
    });
}
