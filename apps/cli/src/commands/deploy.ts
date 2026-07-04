import { Command } from 'commander';
import pc from 'picocolors';
import { SSE_CHANNELS, TERMINAL_DEPLOYMENT_STATUSES, type DeploymentStatus } from '@noderail/shared';
import { requireClient, resolveAppId, type GlobalFlags } from '../lib/context.js';
import { CliError } from '../lib/errors.js';
import { info, statusColor, success } from '../lib/output.js';
import { formatLogLine } from '../lib/logfmt.js';

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Deploy the linked app and stream build logs until it finishes')
    .option('-a, --app <id>', 'App id (defaults to the linked app)')
    .option('-r, --ref <ref>', 'Git ref to deploy (defaults to the app branch)')
    .option('-m, --reason <reason>', 'Reason for this deployment (audit trail)')
    .option('--no-follow', 'Trigger the deploy and exit without streaming logs')
    .action(
      async (
        opts: { app?: string; ref?: string; reason?: string; follow?: boolean },
        cmd: Command,
      ) => {
        const flags = cmd.optsWithGlobals() as GlobalFlags;
        const { client } = await requireClient(flags);
        const appId = await resolveAppId(opts.app);

        const { deploymentId, version } = await client.deploy(appId, {
          ref: opts.ref,
          reason: opts.reason,
        });
        success(`Deployment ${pc.bold(`v${version}`)} queued ${pc.dim(`(${deploymentId})`)}`);

        if (opts.follow === false) {
          info(pc.dim(`Follow with: noderail logs --deployment ${deploymentId}`));
          return;
        }

        info(pc.dim('Streaming build logs… (Ctrl-C to detach)'));
        const controller = new AbortController();
        let finalStatus: DeploymentStatus | undefined;

        const onSigint = () => controller.abort();
        process.once('SIGINT', onSigint);

        try {
          await client.streamChannel(
            SSE_CHANNELS.deployment(deploymentId),
            (evt) => {
              if (evt.event === 'log.build') {
                const parsed = safeJson(evt.data);
                info(formatLogLine(parsed));
              } else if (evt.event === 'deployment.status') {
                const parsed = safeJson(evt.data) as { status?: string } | null;
                const status = parsed?.status as DeploymentStatus | undefined;
                if (status) {
                  info(pc.dim(`— status: ${statusColor(status)}`));
                  if (TERMINAL_DEPLOYMENT_STATUSES.includes(status)) {
                    finalStatus = status;
                    return false; // stop streaming
                  }
                }
              }
              return undefined;
            },
            controller.signal,
          );
        } catch (err) {
          if (controller.signal.aborted) {
            info('');
            info(pc.dim(`Detached. The deployment continues on the server (${deploymentId}).`));
            return;
          }
          throw err;
        } finally {
          process.removeListener('SIGINT', onSigint);
        }

        // Stream ended without a terminal event — reconcile via the API.
        if (!finalStatus) {
          const { deployments } = await client.listDeployments(appId);
          finalStatus = deployments.find((d) => d.id === deploymentId)?.status;
        }

        if (finalStatus === 'running') {
          success(`Deployment ${pc.bold(`v${version}`)} is live.`);
          return;
        }
        throw new CliError(
          `Deployment ${finalStatus ? `ended as "${finalStatus}"` : 'did not reach a running state'}.`,
          1,
          `Inspect logs: noderail logs --deployment ${deploymentId}`,
        );
      },
    );
}

function safeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return { message: data };
  }
}
