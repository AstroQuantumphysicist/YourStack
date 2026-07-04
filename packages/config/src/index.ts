import { z } from 'zod';

/**
 * Centralized, typed environment parsing. Each service calls `loadConfig()` once
 * at boot and passes the frozen result around. Fails fast with a readable error
 * in production; in development, missing optional secrets degrade gracefully.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),

  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  BASE_PREVIEW_DOMAIN: z.string().default('preview.yourstack.local'),

  ADMIN_EMAILS: csv,
  CORS_ORIGINS: csv,

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type RawConfig = z.infer<typeof baseSchema>;

export interface AppConfig extends RawConfig {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  /** GitHub OAuth is fully configured. */
  githubConfigured: boolean;
  githubWebhookConfigured: boolean;
}

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = baseSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const c = parsed.data;

  // Extra guardrails that only apply in production.
  if (c.NODE_ENV === 'production') {
    if (c.SESSION_SECRET.startsWith('change-me')) {
      throw new Error('SESSION_SECRET must be changed from the example value in production');
    }
    if (/^0+$/.test(c.SECRETS_ENCRYPTION_KEY)) {
      throw new Error('SECRETS_ENCRYPTION_KEY must be a real random key in production');
    }
  }

  cached = {
    ...c,
    isProduction: c.NODE_ENV === 'production',
    isDevelopment: c.NODE_ENV === 'development',
    isTest: c.NODE_ENV === 'test',
    githubConfigured: Boolean(c.GITHUB_CLIENT_ID && c.GITHUB_CLIENT_SECRET),
    githubWebhookConfigured: Boolean(c.GITHUB_WEBHOOK_SECRET),
  };
  return cached;
}

/** Test helper to reset the memoized config. */
export function resetConfigCache(): void {
  cached = null;
}

export { bool, csv };
