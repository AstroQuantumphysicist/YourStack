import { Command } from 'commander';
import pc from 'picocolors';
import { CliError } from './lib/errors.js';
import { errorLine, info } from './lib/output.js';
import { registerLogin } from './commands/login.js';
import { registerLogout, registerWhoami } from './commands/auth.js';
import { registerInit } from './commands/init.js';
import { registerNode } from './commands/node.js';
import { registerDeploy } from './commands/deploy.js';
import { registerLogs } from './commands/logs.js';
import { registerApps } from './commands/apps.js';
import { registerEnv } from './commands/env.js';
import { registerRollback } from './commands/rollback.js';
import { registerMcp } from './commands/mcp.js';
import { registerApply } from './commands/apply.js';

/** CLI version. Kept in sync with package.json. */
const VERSION = '0.1.0';

function buildProgram(): Command {
  const program = new Command();
  program
    .name('yst')
    .description('YourStack developer CLI (yst) — bring your own server, we turn it into a cloud.')
    .version(VERSION, '-v, --version', 'Print the CLI version')
    .option('--api-url <url>', 'YourStack API base URL (overrides config / YOURSTACK_API_URL)')
    .option('--token <token>', 'API token (overrides config / YOURSTACK_TOKEN)')
    .showHelpAfterError(pc.dim('(run `yst --help` for usage)'));

  // `version` subcommand in addition to the `-v/--version` flag.
  program
    .command('version')
    .description('Print the CLI version')
    .action(() => info(VERSION));

  registerLogin(program);
  registerLogout(program);
  registerWhoami(program);
  registerInit(program);
  registerNode(program);
  registerDeploy(program);
  registerLogs(program);
  registerApps(program);
  registerEnv(program);
  registerRollback(program);
  registerApply(program);
  registerMcp(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    handleError(err);
  }
}

function handleError(err: unknown): never {
  if (err instanceof CliError) {
    errorLine(err.message);
    if (err.hint) info(pc.dim(err.hint));
    process.exit(err.exitCode);
  }
  const message = err instanceof Error ? err.message : String(err);
  errorLine(message);
  if (process.env.YOURSTACK_DEBUG && err instanceof Error && err.stack) {
    info(pc.dim(err.stack));
  } else {
    info(pc.dim('Set YOURSTACK_DEBUG=1 for a full stack trace.'));
  }
  process.exit(1);
}

void main();
