import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ApiClient } from '../lib/client.js';
import { DEFAULT_API_URL, loadConfig, saveConfig } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import { info, success } from '../lib/output.js';
import type { GlobalFlags } from '../lib/context.js';

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('Authenticate with a YourStack API token')
    .option('--token <token>', 'API token (ys_…). Also read from YOURSTACK_TOKEN')
    .action(async (opts: { token?: string }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags & { token?: string };
      const stored = await loadConfig();
      const apiUrl = (flags.apiUrl ?? stored.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');

      let token = opts.token ?? process.env.YOURSTACK_TOKEN?.trim();
      if (!token) {
        const answer = await p.password({
          message: `Paste your API token for ${pc.cyan(apiUrl)}`,
          validate: (v) => (v && v.startsWith('ys_') ? undefined : 'Tokens start with "ys_".'),
        });
        if (p.isCancel(answer)) throw new CliError('Login cancelled.', 130);
        token = answer;
      }
      token = token.trim();
      if (!token.startsWith('ys_')) {
        throw new CliError('That does not look like a YourStack API token (expected an "ys_" prefix).');
      }

      // Validate the token by fetching the current identity.
      const client = new ApiClient({ apiUrl, token });
      const me = await client.me();

      await saveConfig({
        apiUrl,
        token,
        user: { id: me.user.id, email: me.user.email },
        workspaceId: me.workspaces[0]?.id ?? stored.workspaceId,
      });

      success(`Logged in as ${pc.bold(me.user.email)} on ${pc.cyan(apiUrl)}`);
      if (me.workspaces.length > 0) {
        info(
          `  Workspaces: ${me.workspaces.map((w) => `${w.slug} (${w.role})`).join(', ')}`,
        );
      }
    });
}
