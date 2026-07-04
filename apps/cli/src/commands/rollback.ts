import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { DeploymentDTO } from '@noderail/shared';
import { requireClient, resolveAppId, type GlobalFlags } from '../lib/context.js';
import { CliError } from '../lib/errors.js';
import { info, statusColor, success, timeAgo } from '../lib/output.js';

export function registerRollback(program: Command): void {
  program
    .command('rollback')
    .description('Roll the app back to a previous deployment')
    .option('-a, --app <id>', 'App id (defaults to the linked app)')
    .option('--to <deploymentId>', 'Target deployment id (skips the interactive picker)')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (opts: { app?: string; to?: string; yes?: boolean }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      const { client } = await requireClient(flags);
      const appId = await resolveAppId(opts.app);

      const { deployments } = await client.listDeployments(appId);
      if (deployments.length === 0) {
        throw new CliError('This app has no deployments to roll back to.');
      }

      let targetId = opts.to;
      if (!targetId) {
        // Offer deployments that previously ran (sensible rollback targets),
        // excluding the current/most-recent one.
        const candidates = deployments.filter((d) => d.status === 'running' || d.status === 'rolled_back' || d.status === 'superseded');
        const options = (candidates.length ? candidates : deployments).slice(0, 20);
        const choice = await p.select({
          message: 'Select a deployment to roll back to',
          options: options.map((d) => ({
            value: d.id,
            label: `v${d.version} — ${d.status}`,
            hint: `${timeAgo(d.createdAt)}${d.commitMessage ? ` · ${d.commitMessage.slice(0, 40)}` : ''}`,
          })),
        });
        if (p.isCancel(choice)) throw new CliError('Cancelled.', 130);
        targetId = choice as string;
      }

      const target = deployments.find((d) => d.id === targetId);
      if (!target) throw new CliError(`Deployment ${targetId} not found for this app.`);
      printTarget(target);

      if (!opts.yes) {
        const ok = await p.confirm({ message: `Roll back to v${target.version}?`, initialValue: false });
        if (p.isCancel(ok) || !ok) throw new CliError('Cancelled.', 130);
      }

      await client.rollback(appId, target.id);
      success(`Rollback to ${pc.bold(`v${target.version}`)} queued ${pc.dim(`(${target.id})`)}`);
      info(pc.dim(`Follow with: noderail logs --deployment ${target.id}`));
    });
}

function printTarget(d: DeploymentDTO): void {
  info('');
  info(`  ${pc.bold(`v${d.version}`)}  ${statusColor(d.status)}  ${pc.dim(timeAgo(d.createdAt))}`);
  if (d.commitMessage) info(`  ${pc.dim(d.commitMessage)}`);
  info('');
}
