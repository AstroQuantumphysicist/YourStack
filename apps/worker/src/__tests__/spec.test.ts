import { describe, expect, it } from 'vitest';
import { buildDeploySpec } from '../lib/spec.js';
import type { WorkerContext } from '../context.js';
import type { App, Deployment, GitRepository } from '@noderail/db';

/** Minimal stub context: only the methods buildDeploySpec touches. */
function stubCtx(): WorkerContext {
  return {
    encryptor: { decrypt: (s: string) => s.replace('enc:', ''), encrypt: (s: string) => `enc:${s}` },
    prisma: {
      secret: { findMany: async () => [] },
      domain: { findFirst: async () => null },
    },
  } as unknown as WorkerContext;
}

const baseApp = (over: Partial<App>): App =>
  ({
    id: 'app_123',
    projectId: 'proj_1',
    name: 'web',
    slug: 'web',
    status: 'idle',
    framework: null,
    repoUrl: null,
    gitRepositoryId: null,
    branch: 'main',
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    port: 3000,
    cpu: 0.5,
    memoryMb: 512,
    deploymentStrategy: 'basic_replace',
    healthcheckPath: '/',
    nodeId: 'node_1',
    currentDeploymentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  }) as App;

const deployment = { id: 'dep_1', version: 3, ref: 'main' } as Deployment;

describe('buildDeploySpec', () => {
  it('uses buildpack source for a Next.js repo', async () => {
    const repo = { fullName: 'acme/web', installToken: 'enc:ghtoken' } as GitRepository;
    const spec = await buildDeploySpec(stubCtx(), {
      app: baseApp({ framework: 'nextjs', buildCommand: 'pnpm build', startCommand: 'pnpm start' }),
      deployment,
      repo,
    });
    expect(spec.source.kind).toBe('buildpack');
    if (spec.source.kind === 'buildpack') {
      expect(spec.source.repoUrl).toBe('https://github.com/acme/web.git');
      expect(spec.source.cloneToken).toBe('ghtoken');
      expect(spec.source.framework).toBe('nextjs');
    }
    expect(spec.imageTag).toBe('noderail/app_123:3');
    expect(spec.env.PORT).toBe('3000');
  });

  it('uses git/dockerfile source when framework is dockerfile', async () => {
    const repo = { fullName: 'acme/api', installToken: null } as GitRepository;
    const spec = await buildDeploySpec(stubCtx(), {
      app: baseApp({ framework: 'dockerfile' }),
      deployment,
      repo,
    });
    expect(spec.source.kind).toBe('git');
  });

  it('falls back to a demo image with no repo', async () => {
    const spec = await buildDeploySpec(stubCtx(), { app: baseApp({}), deployment, repo: null });
    expect(spec.source.kind).toBe('image');
    if (spec.source.kind === 'image') expect(spec.source.image).toContain('whoami');
  });

  it('treats a bare repoUrl as an image reference', async () => {
    const spec = await buildDeploySpec(stubCtx(), {
      app: baseApp({ repoUrl: 'nginx:1.27' }),
      deployment,
      repo: null,
    });
    expect(spec.source.kind).toBe('image');
    if (spec.source.kind === 'image') expect(spec.source.image).toBe('nginx:1.27');
  });
});
