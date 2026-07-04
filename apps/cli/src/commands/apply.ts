import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { parse as parseYaml } from 'yaml';
import { requireClient, type GlobalFlags } from '../lib/context.js';
import { loadLink } from '../lib/context.js';
import { CliError } from '../lib/errors.js';
import { info, success } from '../lib/output.js';

interface PlanItem {
  kind: string;
  name: string;
  action: 'create' | 'update' | 'noop';
}

/**
 * `yst apply` — reconcile a `yourstack.yaml` blueprint into real resources.
 * Runs a dry-run plan first, prints it, then applies (unless --dry-run).
 */
export function registerApply(program: Command): void {
  program
    .command('apply')
    .description('Apply a yourstack.yaml blueprint (create/update apps, databases, firewalls, LBs, …).')
    .option('-f, --file <path>', 'Path to the blueprint file', 'yourstack.yaml')
    .option('-w, --workspace <id>', 'Workspace to apply into (defaults to the linked workspace)')
    .option('--dry-run', 'Only show the plan; do not apply', false)
    .option('--yes', 'Skip the confirmation prompt', false)
    .action(async (opts: { file: string; workspace?: string; dryRun: boolean; yes: boolean }) => {
      const flags = program.opts<GlobalFlags>();
      const { client } = await requireClient(flags);

      const path = resolve(process.cwd(), opts.file);
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        throw new CliError(`Could not read ${opts.file}.`, 1, 'Create a yourstack.yaml or pass --file.');
      }
      const blueprint = parseYaml(raw) as unknown;

      const link = await loadLink();
      const workspaceId = opts.workspace ?? link?.workspaceId;
      if (!workspaceId) {
        throw new CliError('No workspace specified.', 1, 'Pass --workspace <id> or run `yst init`.');
      }

      // 1) dry-run plan
      const plan = await client.post<{ plan: PlanItem[] }>('/blueprint/apply', {
        workspaceId,
        blueprint,
        dryRun: true,
      });
      info(pc.bold('Plan:'));
      for (const item of plan.plan) {
        const badge =
          item.action === 'create' ? pc.green('+ create') : item.action === 'update' ? pc.yellow('~ update') : pc.dim('· noop');
        info(`  ${badge}  ${pc.cyan(item.kind)} ${item.name}`);
      }
      const changes = plan.plan.filter((p) => p.action !== 'noop').length;
      if (opts.dryRun) {
        info(`\n${changes} change(s). Dry run — nothing applied.`);
        return;
      }
      if (changes === 0) {
        success('Everything is already up to date.');
        return;
      }

      if (!opts.yes) {
        const { confirm } = await import('@clack/prompts');
        const go = await confirm({ message: `Apply ${changes} change(s) to workspace ${workspaceId}?` });
        if (go !== true) {
          info('Aborted.');
          return;
        }
      }

      const result = await client.post<{ applied: PlanItem[] }>('/blueprint/apply', {
        workspaceId,
        blueprint,
        dryRun: false,
      });
      success(`Applied ${result.applied?.length ?? changes} resource(s).`);
    });
}
