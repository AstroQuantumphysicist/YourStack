import type { Command } from 'commander';
import { YourStackClient, startMcpServer } from '@yourstack/mcp';
import { loadConfig } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import type { GlobalFlags } from '../lib/context.js';

/**
 * `yst mcp` — run the Model Context Protocol server over stdio using your saved
 * login, so an AI agent (Claude Desktop, Cursor, Claude Code) can control
 * YourStack. Configure your client to launch `yst mcp`.
 *
 * IMPORTANT: in this mode stdout is the MCP protocol channel — we print nothing
 * to stdout; diagnostics go to stderr.
 */
export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('Run the MCP server so an AI agent can control YourStack (uses your saved login).')
    .action(async () => {
      const flags = program.opts<GlobalFlags>();
      const config = await loadConfig();
      const apiUrl = flags.apiUrl ?? config.apiUrl;
      const token = flags.token ?? config.token;
      if (!token) {
        throw new CliError('You are not logged in.', 1, 'Run `yst login` first, then add `yst mcp` to your AI client.');
      }
      const client = new YourStackClient(apiUrl, token);
      // Blocks, serving the MCP protocol over stdio until the client disconnects.
      await startMcpServer(client);
    });
}
