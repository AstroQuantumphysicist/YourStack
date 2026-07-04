import { defineConfig } from 'vitest/config';

// Provide sane defaults so unit tests run without a full .env. Integration tests
// that need Postgres/Redis self-skip when those services are unreachable.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://yourstack:yourstack@localhost:5432/yourstack?schema=public',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'test-session-secret-000000000000',
      SECRETS_ENCRYPTION_KEY:
        process.env.SECRETS_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ADMIN_EMAILS: 'admin@yourstack.local',
    },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
