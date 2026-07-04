import { z } from 'zod';
import { AppFramework } from '../enums.js';

/**
 * Schema + parser for the in-repo `noderail.yml` pipeline config.
 * The worker reads this file at checkout; when absent it falls back to
 * framework auto-detection (see `detectFramework`).
 */
export const noderailConfigSchema = z.object({
  name: z.string().min(1),
  on: z
    .object({
      push: z
        .object({
          branches: z.array(z.string()).default(['main']),
        })
        .default({ branches: ['main'] }),
      pull_request: z.boolean().default(false),
    })
    .default({ push: { branches: ['main'] }, pull_request: false }),
  build: z
    .object({
      install: z.string().optional(),
      test: z.string().optional(),
      command: z.string().optional(),
      dockerfile: z.string().optional(),
    })
    .default({}),
  deploy: z.object({
    start: z.string().optional(),
    port: z.number().int().positive().default(3000),
    resources: z
      .object({
        cpu: z.union([z.number(), z.string()]).optional(),
        memory: z.union([z.number(), z.string()]).optional(),
      })
      .default({}),
    healthcheck: z
      .object({
        path: z.string().default('/'),
      })
      .optional(),
  }),
});
export type NoderailConfig = z.infer<typeof noderailConfigSchema>;

export interface ParseResult {
  ok: boolean;
  config?: NoderailConfig;
  errors?: string[];
}

/**
 * Validate an already-parsed YAML/JSON object against the schema.
 * (YAML parsing itself is done by the worker with `yaml`, which has no browser
 * deps; this keeps @noderail/shared dependency-light.)
 */
export function validateNoderailConfig(raw: unknown): ParseResult {
  const result = noderailConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export interface DetectedProject {
  framework: AppFramework;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  port: number;
}

/**
 * Heuristic framework auto-detection from a repository file listing.
 * `files` is a set of top-level (and a few nested) paths present in the repo.
 * `packageJson` is the parsed package.json if present.
 */
export function detectFramework(
  files: Set<string>,
  packageJson?: { dependencies?: Record<string, string>; scripts?: Record<string, string> },
): DetectedProject {
  const has = (f: string) => files.has(f);
  const deps = { ...packageJson?.dependencies };
  const scripts = packageJson?.scripts ?? {};
  const pkgMgr = has('pnpm-lock.yaml')
    ? 'pnpm'
    : has('yarn.lock')
      ? 'yarn'
      : has('package-lock.json')
        ? 'npm'
        : 'npm';
  const install =
    pkgMgr === 'pnpm'
      ? 'pnpm install --frozen-lockfile'
      : pkgMgr === 'yarn'
        ? 'yarn install --frozen-lockfile'
        : 'npm ci';
  const run = (script: string) =>
    pkgMgr === 'npm' ? `npm run ${script}` : `${pkgMgr} ${script}`;

  if (has('Dockerfile')) {
    return { framework: AppFramework.DOCKERFILE, port: 3000 };
  }
  if (deps.next || scripts.build?.includes('next') || scripts.dev?.includes('next')) {
    return {
      framework: AppFramework.NEXTJS,
      installCommand: install,
      buildCommand: run('build'),
      startCommand: run('start'),
      port: 3000,
    };
  }
  if (has('package.json')) {
    return {
      framework: AppFramework.NODE,
      installCommand: install,
      buildCommand: scripts.build ? run('build') : undefined,
      startCommand: scripts.start ? run('start') : 'node index.js',
      port: 3000,
    };
  }
  if (has('requirements.txt') || has('pyproject.toml') || has('Pipfile')) {
    const installCmd = has('requirements.txt')
      ? 'pip install -r requirements.txt'
      : has('pyproject.toml')
        ? 'pip install .'
        : 'pipenv install';
    return {
      framework: AppFramework.PYTHON,
      installCommand: installCmd,
      startCommand: 'python app.py',
      port: 8000,
    };
  }
  if (has('index.html')) {
    return { framework: AppFramework.STATIC, port: 80 };
  }
  // Fallback: treat as static site.
  return { framework: AppFramework.STATIC, port: 80 };
}
