import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * config.ts resolves the config path from os.homedir() at import time, so we
 * point HOME/USERPROFILE at a throwaway directory and import the module fresh
 * for each test via vitest's module reset.
 */
describe('config round-trip', () => {
  let home: string;
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  const savedApiUrl = process.env.NODERAIL_API_URL;
  const savedToken = process.env.NODERAIL_TOKEN;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'noderail-cli-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.NODERAIL_API_URL;
    delete process.env.NODERAIL_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    restore('HOME', savedHome);
    restore('USERPROFILE', savedUserProfile);
    restore('NODERAIL_API_URL', savedApiUrl);
    restore('NODERAIL_TOKEN', savedToken);
  });

  it('saves and loads credentials', async () => {
    const { saveConfig, loadConfig, configPath } = await import('./config.js');
    expect(configPath().startsWith(home)).toBe(true);

    await saveConfig({
      apiUrl: 'http://localhost:4000',
      token: 'nr_test_token',
      user: { id: 'u1', email: 'a@b.co' },
      workspaceId: 'ws1',
    });

    const loaded = await loadConfig();
    expect(loaded.apiUrl).toBe('http://localhost:4000');
    expect(loaded.token).toBe('nr_test_token');
    expect(loaded.user).toEqual({ id: 'u1', email: 'a@b.co' });
    expect(loaded.workspaceId).toBe('ws1');
  });

  it('returns defaults when no config exists', async () => {
    const { loadConfig, DEFAULT_API_URL } = await import('./config.js');
    const loaded = await loadConfig();
    expect(loaded.apiUrl).toBe(DEFAULT_API_URL);
    expect(loaded.token).toBeUndefined();
  });

  it('lets environment variables override on-disk values', async () => {
    const { saveConfig, loadConfig } = await import('./config.js');
    await saveConfig({ apiUrl: 'http://disk:4000', token: 'nr_disk' });
    process.env.NODERAIL_API_URL = 'http://env:5000';
    process.env.NODERAIL_TOKEN = 'nr_env';
    const loaded = await loadConfig();
    expect(loaded.apiUrl).toBe('http://env:5000');
    expect(loaded.token).toBe('nr_env');
  });

  it('clears credentials', async () => {
    const { saveConfig, clearConfig, loadConfig, DEFAULT_API_URL } = await import('./config.js');
    await saveConfig({ apiUrl: 'http://x:1', token: 'nr_x' });
    await clearConfig();
    const loaded = await loadConfig();
    expect(loaded.apiUrl).toBe(DEFAULT_API_URL);
    expect(loaded.token).toBeUndefined();
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
