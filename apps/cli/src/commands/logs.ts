import { Command } from 'commander';
import pc from 'picocolors';
import { SSE_CHANNELS } from '@yourstack/shared';
import { requireClient, resolveAppId, type GlobalFlags } from '../lib/context.js';
import { info, printJson } from '../lib/output.js';
import { formatLogLine } from '../lib/logfmt.js';

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Stream live app logs (or build logs for a deployment)')
    .option('-a, --app <id>', 'App id (defaults to the linked app)')
    .option('-d, --deployment <id>', 'Show build logs for a deployment instead of runtime logs')
    .option('--since <iso>', 'Only show stored logs at/after this ISO timestamp')
    .option('--no-follow', 'Print stored logs and exit (do not stream)')
    .option('--json', 'Output stored logs as JSON (implies --no-follow)')
    .action(
      async (
        opts: {
          app?: string;
          deployment?: string;
          since?: string;
          follow?: boolean;
          json?: boolean;
        },
        cmd: Command,
      ) => {
        const flags = cmd.optsWithGlobals() as GlobalFlags;
        const { client } = await requireClient(flags);

        if (opts.deployment) {
          await runDeploymentLogs(client, opts);
          return;
        }

        const appId = await resolveAppId(opts.app);

        // Print any stored history first (bounded by --since when provided).
        const { logs } = await client.getAppLogs(appId, { since: opts.since, limit: 200 });
        if (opts.json) {
          printJson(logs);
          return;
        }
        for (const l of logs) info(formatLogLine(l));

        if (opts.follow === false) return;

        info(pc.dim('— streaming live logs (Ctrl-C to stop) —'));
        await followChannel(client, SSE_CHANNELS.app(appId), 'log.runtime');
      },
    );
}

async function runDeploymentLogs(
  client: Awaited<ReturnType<typeof requireClient>>['client'],
  opts: { deployment?: string; follow?: boolean; json?: boolean },
): Promise<void> {
  const deploymentId = opts.deployment!;
  const { logs } = await client.getDeploymentLogs(deploymentId, 500);
  if (opts.json) {
    printJson(logs);
    return;
  }
  for (const l of logs) info(formatLogLine(l));
  if (opts.follow === false) return;

  info(pc.dim('— streaming build logs (Ctrl-C to stop) —'));
  await followChannel(client, SSE_CHANNELS.deployment(deploymentId), 'log.build');
}

async function followChannel(
  client: Awaited<ReturnType<typeof requireClient>>['client'],
  channel: string,
  eventType: string,
): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);
  try {
    await client.streamChannel(
      channel,
      (evt) => {
        if (evt.event === eventType) {
          try {
            info(formatLogLine(JSON.parse(evt.data)));
          } catch {
            info(evt.data);
          }
        }
        return undefined;
      },
      controller.signal,
    );
  } catch (err) {
    if (controller.signal.aborted) return; // user detached — clean exit
    throw err;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
