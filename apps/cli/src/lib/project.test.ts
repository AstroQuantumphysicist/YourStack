import { describe, expect, it } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { validateNoderailConfig } from '@noderail/shared';
import { buildNoderailConfig, renderNoderailYaml } from './project.js';

describe('buildNoderailConfig', () => {
  it('produces a schema-valid config with only required fields', () => {
    const config = buildNoderailConfig({ name: 'my-app', port: 3000 });
    const result = validateNoderailConfig(config);
    expect(result.ok).toBe(true);
  });

  it('includes optional build/deploy fields when provided', () => {
    const config = buildNoderailConfig({
      name: 'web',
      branch: 'release',
      install: 'pnpm install',
      build: 'pnpm build',
      start: 'pnpm start',
      port: 8080,
    });
    expect(config.on.push.branches).toEqual(['release']);
    expect(config.build.install).toBe('pnpm install');
    expect(config.build.command).toBe('pnpm build');
    expect(config.deploy.start).toBe('pnpm start');
    expect(config.deploy.port).toBe(8080);
  });

  it('renders YAML that round-trips back into a valid config', () => {
    const config = buildNoderailConfig({ name: 'api', port: 4000, install: 'npm ci' });
    const yaml = renderNoderailYaml(config);
    expect(yaml).toContain('name: api');
    const reparsed = yamlParse(yaml);
    expect(validateNoderailConfig(reparsed).ok).toBe(true);
  });
});
