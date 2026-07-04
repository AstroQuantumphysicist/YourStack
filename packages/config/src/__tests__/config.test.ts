import { describe, expect, it, beforeEach } from 'vitest';
import { loadConfig, resetConfigCache } from '../index.js';

const validEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a-sufficiently-long-secret',
  SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('loadConfig', () => {
  beforeEach(() => resetConfigCache());

  it('parses a valid environment', () => {
    const c = loadConfig(validEnv as NodeJS.ProcessEnv);
    expect(c.isDevelopment).toBe(true);
    expect(c.PORT).toBe(4000);
    expect(c.githubConfigured).toBe(false);
  });

  it('throws on a bad encryption key', () => {
    expect(() =>
      loadConfig({ ...validEnv, SECRETS_ENCRYPTION_KEY: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });

  it('rejects example secrets in production', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: 'production',
        SESSION_SECRET: 'change-me-please',
      } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });

  it('parses CSV admin emails', () => {
    const c = loadConfig({ ...validEnv, ADMIN_EMAILS: 'a@x.com, b@y.com' } as NodeJS.ProcessEnv);
    expect(c.ADMIN_EMAILS).toEqual(['a@x.com', 'b@y.com']);
  });
});
