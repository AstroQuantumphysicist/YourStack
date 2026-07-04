import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { WorkspaceDTO } from '@noderail/shared';
import type { ApiClient } from './client.js';
import type { CliConfig } from './config.js';
import { CliError } from './errors.js';
import { loadProjectLink } from './project.js';

/**
 * Resolve the target workspace id. Precedence: explicit flag → local project
 * link → saved default → interactive select (or the sole workspace).
 */
export async function resolveWorkspaceId(
  client: ApiClient,
  config: CliConfig,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) return explicit;

  const link = await loadProjectLink();
  if (link?.workspaceId) return link.workspaceId;
  if (config.workspaceId) return config.workspaceId;

  const { workspaces } = await client.me();
  if (workspaces.length === 0) {
    throw new CliError('You have no workspaces. Create one in the web dashboard first.');
  }
  if (workspaces.length === 1) return workspaces[0]!.id;

  const id = await p.select({
    message: 'Select a workspace',
    options: workspaces.map((w: WorkspaceDTO) => ({ value: w.id, label: w.slug, hint: w.role })),
  });
  if (p.isCancel(id)) throw new CliError('Cancelled.', 130);
  return id as string;
}

export function workspaceHint(): string {
  return pc.dim('Pass --workspace <id> to target a specific workspace.');
}
