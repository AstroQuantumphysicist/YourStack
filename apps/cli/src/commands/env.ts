import { Command } from 'commander';
import pc from 'picocolors';
import { requireClient, resolveAppId, type GlobalFlags } from '../lib/context.js';
import { parseKeyValue } from '../lib/env.js';
import { success } from '../lib/output.js';

export function registerEnv(program: Command): void {
  const env = program.command('env').description('Manage app-scoped secrets / env vars');

  env
    .command('set <pair...>')
    .description('Set one or more app secrets (KEY=VALUE …)')
    .option('-a, --app <id>', 'App id (defaults to the linked app)')
    .action(async (pairs: string[], opts: { app?: string }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      const { client } = await requireClient(flags);
      const appId = await resolveAppId(opts.app);

      const parsed = pairs.map(parseKeyValue);
      for (const { key, value } of parsed) {
        await client.setAppSecret(appId, key, value);
        success(`Set ${pc.bold(key)} ${pc.dim(`(${value.length} chars)`)}`);
      }
      success(
        `Updated ${parsed.length} secret${parsed.length === 1 ? '' : 's'}. ` +
          pc.dim('Redeploy for changes to take effect.'),
      );
    });
}
