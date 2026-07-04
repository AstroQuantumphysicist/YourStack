import { Command } from 'commander';
import pc from 'picocolors';
import { requireClient, type GlobalFlags } from '../lib/context.js';
import { info, printJson, renderTable, statusColor, success, timeAgo } from '../lib/output.js';
import { resolveWorkspaceId } from '../lib/workspace.js';

export function registerNode(program: Command): void {
  const node = program.command('node').description('Manage YourStack nodes (your servers)');

  node
    .command('join')
    .description('Create a one-time join token and print the install command for a server')
    .option('-w, --workspace <id>', 'Workspace id (defaults to the linked/first workspace)')
    .option('--label <label>', 'Optional label for the node')
    .option('--region <region>', 'Optional region for the node')
    .option('--print-token', 'Print the raw join token (sensitive)')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        opts: { workspace?: string; label?: string; region?: string; printToken?: boolean; json?: boolean },
        cmd: Command,
      ) => {
        const flags = cmd.optsWithGlobals() as GlobalFlags;
        const { client, config } = await requireClient(flags);
        const workspaceId = await resolveWorkspaceId(client, config, opts.workspace);

        const res = await client.createJoinToken(workspaceId, {
          label: opts.label,
          region: opts.region,
        });

        if (opts.json) {
          printJson(res);
          return;
        }

        const expires = new Date(res.expiresAt);
        info('');
        info(pc.bold('Run this on the server you want to add to YourStack:'));
        info('');
        info('  ' + pc.cyan(res.installCommand));
        info('');
        info(pc.dim(`API URL:  ${res.apiUrl}`));
        info(pc.dim(`Expires:  ${expires.toLocaleString()} (${timeAgo(res.expiresAt)} from now is when it was issued)`));
        if (opts.printToken) {
          info('');
          info(`${pc.yellow('Join token:')} ${res.joinToken}`);
        } else {
          info('');
          info(pc.dim('The join token is embedded in the command above. Use --print-token to reveal it.'));
        }
        info('');
        success('Token created. It can be used once, before it expires.');
      },
    );

  node
    .command('list')
    .alias('ls')
    .description('List nodes in a workspace')
    .option('-w, --workspace <id>', 'Workspace id (defaults to the linked/first workspace)')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { workspace?: string; json?: boolean }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      const { client, config } = await requireClient(flags);
      const workspaceId = await resolveWorkspaceId(client, config, opts.workspace);
      const { nodes } = await client.listNodes(workspaceId);

      if (opts.json) {
        printJson(nodes);
        return;
      }
      info(
        renderTable(nodes, [
          { header: 'NAME', value: (n) => n.name },
          { header: 'STATUS', value: (n) => statusColor(n.status) },
          { header: 'REGION', value: (n) => n.region ?? pc.dim('—') },
          { header: 'APPS', value: (n) => String(n.runningAppCount) },
          { header: 'IP', value: (n) => n.publicIp ?? pc.dim('—') },
          { header: 'HEARTBEAT', value: (n) => timeAgo(n.lastHeartbeatAt) },
          { header: 'ID', value: (n) => pc.dim(n.id) },
        ]),
      );
    });

  // --- Node administration: manage the connected server itself ---
  const runAction = async (
    nodeId: string,
    action: 'reboot' | 'docker_prune' | 'agent_update',
    flags: GlobalFlags,
    version?: string,
  ) => {
    const { client } = await requireClient(flags);
    await client.post(`/nodes/${nodeId}/actions`, { action, version });
    success(`Dispatched ${pc.cyan(action)} to node ${nodeId}.`);
  };

  node
    .command('reboot <nodeId>')
    .description('Reboot a connected node')
    .action((nodeId: string, _o: unknown, cmd: Command) =>
      runAction(nodeId, 'reboot', cmd.optsWithGlobals() as GlobalFlags),
    );

  node
    .command('prune <nodeId>')
    .description('Prune unused Docker images/build cache on a node to reclaim disk')
    .action((nodeId: string, _o: unknown, cmd: Command) =>
      runAction(nodeId, 'docker_prune', cmd.optsWithGlobals() as GlobalFlags),
    );

  node
    .command('update-agent <nodeId>')
    .description('Update the YourStack agent on a node')
    .option('--version <v>', 'Agent version/channel', 'latest')
    .action((nodeId: string, opts: { version?: string }, cmd: Command) =>
      runAction(nodeId, 'agent_update', cmd.optsWithGlobals() as GlobalFlags, opts.version),
    );

  node
    .command('commands <nodeId>')
    .description('Show recent commands dispatched to a node')
    .option('--json', 'Output raw JSON')
    .action(async (nodeId: string, opts: { json?: boolean }, cmd: Command) => {
      const { client } = await requireClient(cmd.optsWithGlobals() as GlobalFlags);
      const { commands } = await client.get<{ commands: Array<{ type: string; status: string; createdAt: string }> }>(
        `/nodes/${nodeId}/commands`,
      );
      if (opts.json) return printJson(commands);
      info(
        renderTable(commands, [
          { header: 'TYPE', value: (c) => c.type },
          { header: 'STATUS', value: (c) => statusColor(c.status) },
          { header: 'WHEN', value: (c) => timeAgo(c.createdAt) },
        ]),
      );
    });
}
