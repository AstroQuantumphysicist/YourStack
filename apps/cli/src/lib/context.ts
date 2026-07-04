import pc from 'picocolors';
import { ApiClient } from './client.js';
import { loadConfig, type CliConfig } from './config.js';
import { CliError } from './errors.js';
import { loadProjectLink, type ProjectLink } from './project.js';

/** Global flags available on every command via the root program. */
export interface GlobalFlags {
  apiUrl?: string;
  token?: string;
}

/**
 * Build an `ApiClient` from stored config plus per-invocation flag overrides.
 * Does NOT require authentication (used by `login` itself).
 */
export async function makeClient(flags: GlobalFlags): Promise<{ client: ApiClient; config: CliConfig }> {
  const config = await loadConfig();
  const apiUrl = flags.apiUrl ?? config.apiUrl;
  const token = flags.token ?? config.token;
  return { client: new ApiClient({ apiUrl, token }), config };
}

/** Like {@link makeClient}, but throws a friendly error when no token is set. */
export async function requireClient(
  flags: GlobalFlags,
): Promise<{ client: ApiClient; config: CliConfig }> {
  const { client, config } = await makeClient(flags);
  const token = flags.token ?? config.token;
  if (!token) {
    throw new CliError(
      'You are not logged in.',
      1,
      `Run ${pc.cyan('noderail login')} (or set ${pc.cyan('NODERAIL_TOKEN')}).`,
    );
  }
  return { client, config };
}

/**
 * Resolve the target app id: an explicit `--app` flag wins, otherwise the app
 * recorded in `.noderail/project.json`. Throws with guidance when neither is
 * available.
 */
export async function resolveAppId(explicit: string | undefined): Promise<string> {
  if (explicit) return explicit;
  const link = await loadProjectLink();
  if (link?.appId) return link.appId;
  throw new CliError(
    'No app specified and none linked in this directory.',
    1,
    `Pass ${pc.cyan('--app <id>')} or run ${pc.cyan('noderail init')} to link this directory.`,
  );
}

/** Resolve a project id from `--project` or the local link. */
export async function resolveProjectId(explicit: string | undefined): Promise<string> {
  if (explicit) return explicit;
  const link = await loadProjectLink();
  if (link?.projectId) return link.projectId;
  throw new CliError(
    'No project specified and none linked in this directory.',
    1,
    `Pass ${pc.cyan('--project <id>')} or run ${pc.cyan('noderail init')}.`,
  );
}

export async function loadLink(): Promise<ProjectLink | null> {
  return loadProjectLink();
}
