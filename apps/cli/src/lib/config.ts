import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

/** Default API base URL for local development. */
export const DEFAULT_API_URL = 'http://localhost:4000';

/** Persisted CLI credentials, stored at `~/.yourstack/config.json` (0600). */
export interface CliConfig {
  apiUrl: string;
  token?: string;
  /** Cached identity, refreshed on login. Purely informational. */
  user?: { id: string; email: string };
  /** Default workspace id to use when a command doesn't specify one. */
  workspaceId?: string;
}

const CONFIG_DIR = join(homedir(), '.yourstack');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function configPath(): string {
  return CONFIG_PATH;
}

/**
 * Load the stored config, applying environment overrides. `YOURSTACK_API_URL`
 * and `YOURSTACK_TOKEN` always win over the on-disk values so CI can inject
 * credentials without a login step.
 */
export async function loadConfig(): Promise<CliConfig> {
  let base: CliConfig = { apiUrl: DEFAULT_API_URL };
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    base = {
      apiUrl: parsed.apiUrl ?? DEFAULT_API_URL,
      token: parsed.token,
      user: parsed.user,
      workspaceId: parsed.workspaceId,
    };
  } catch {
    // No config file yet, or unreadable — fall back to defaults.
  }

  const envUrl = process.env.YOURSTACK_API_URL?.trim();
  const envToken = process.env.YOURSTACK_TOKEN?.trim();
  if (envUrl) base.apiUrl = envUrl;
  if (envToken) base.token = envToken;
  return base;
}

/** Persist the config with owner-only permissions (0600). */
export async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const payload = JSON.stringify(config, null, 2) + '\n';
  await writeFile(CONFIG_PATH, payload, { mode: 0o600 });
  // Some platforms ignore the `mode` on an existing file; enforce it.
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // chmod is a no-op / unsupported on some filesystems (e.g. Windows).
  }
}

/** Remove stored credentials. Safe to call when no config exists. */
export async function clearConfig(): Promise<void> {
  await rm(CONFIG_PATH, { force: true });
}
