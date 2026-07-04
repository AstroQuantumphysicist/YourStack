import { Command } from 'commander';
import pc from 'picocolors';
import { clearConfig } from '../lib/config.js';
import { makeClient, requireClient, type GlobalFlags } from '../lib/context.js';
import { info, printJson, success, warn } from '../lib/output.js';

export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Show the currently authenticated user and workspaces')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      const { client } = await requireClient(flags);
      const me = await client.me();
      if (opts.json) {
        printJson(me);
        return;
      }
      info(`${pc.bold(me.user.email)}${me.user.name ? pc.dim(` (${me.user.name})`) : ''}`);
      info(pc.dim(`API: ${client.apiUrl}`));
      if (me.workspaces.length === 0) {
        info(pc.dim('No workspaces.'));
      } else {
        info('');
        for (const w of me.workspaces) {
          info(`  ${pc.cyan(w.slug)}  ${pc.dim(w.role)}  ${pc.dim(w.id)}`);
        }
      }
    });
}

export function registerLogout(program: Command): void {
  program
    .command('logout')
    .description('Remove stored credentials')
    .action(async (_opts: unknown, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      // Best-effort server-side session invalidation (token stays valid; this is
      // mostly a no-op for API tokens, but keeps behavior consistent).
      try {
        const { client, config } = await makeClient(flags);
        if (config.token) await client.logout();
      } catch {
        warn('Could not reach the API to end the session; clearing local credentials anyway.');
      }
      await clearConfig();
      success(`Logged out. Run ${pc.cyan('noderail login')} to sign back in.`);
    });
}
