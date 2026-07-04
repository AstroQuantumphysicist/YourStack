import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../canonical.js';
import { parseMemoryToMb } from '../schemas/common.js';
import { detectFramework, validateYourStackConfig } from '../schemas/pipeline.js';
import { Permission, roleAtLeast, roleHasPermission } from '../rbac.js';
import { WorkspaceRole } from '../enums.js';
import { commandPayloadSchema } from '../schemas/commands.js';

describe('canonicalJson', () => {
  it('is stable regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it('produces deterministic output', () => {
    expect(canonicalJson({ z: [3, 2, 1], a: 'x' })).toBe('{"a":"x","z":[3,2,1]}');
  });
});

describe('parseMemoryToMb', () => {
  it('parses GB and MB', () => {
    expect(parseMemoryToMb('1GB')).toBe(1024);
    expect(parseMemoryToMb('512MB')).toBe(512);
    expect(parseMemoryToMb('256')).toBe(256);
    expect(parseMemoryToMb(768)).toBe(768);
  });
  it('rejects garbage', () => {
    expect(() => parseMemoryToMb('lots')).toThrow();
  });
});

describe('detectFramework', () => {
  it('detects Next.js via dependency', () => {
    const d = detectFramework(new Set(['package.json', 'pnpm-lock.yaml']), {
      dependencies: { next: '14.0.0' },
      scripts: { build: 'next build', start: 'next start' },
    });
    expect(d.framework).toBe('nextjs');
    expect(d.installCommand).toBe('pnpm install --frozen-lockfile');
  });
  it('prefers Dockerfile', () => {
    expect(detectFramework(new Set(['Dockerfile', 'package.json'])).framework).toBe('dockerfile');
  });
  it('falls back to static', () => {
    expect(detectFramework(new Set(['index.html'])).framework).toBe('static');
  });
});

describe('validateYourStackConfig', () => {
  it('accepts a valid config', () => {
    const res = validateYourStackConfig({
      name: 'web',
      on: { push: { branches: ['main'] }, pull_request: true },
      build: { install: 'pnpm i', command: 'pnpm build' },
      deploy: { start: 'pnpm start', port: 3000 },
    });
    expect(res.ok).toBe(true);
    expect(res.config?.name).toBe('web');
  });
  it('rejects missing deploy', () => {
    expect(validateYourStackConfig({ name: 'x' }).ok).toBe(false);
  });
});

describe('rbac', () => {
  it('owner can delete workspace, viewer cannot', () => {
    expect(roleHasPermission(WorkspaceRole.OWNER, Permission.WORKSPACE_DELETE)).toBe(true);
    expect(roleHasPermission(WorkspaceRole.VIEWER, Permission.WORKSPACE_DELETE)).toBe(false);
  });
  it('developer can deploy but not remove members', () => {
    expect(roleHasPermission(WorkspaceRole.DEVELOPER, Permission.APP_DEPLOY)).toBe(true);
    expect(roleHasPermission(WorkspaceRole.DEVELOPER, Permission.MEMBER_REMOVE)).toBe(false);
  });
  it('rank comparison', () => {
    expect(roleAtLeast(WorkspaceRole.ADMIN, WorkspaceRole.DEVELOPER)).toBe(true);
    expect(roleAtLeast(WorkspaceRole.VIEWER, WorkspaceRole.ADMIN)).toBe(false);
  });
});

describe('commandPayloadSchema', () => {
  it('validates a DEPLOY_APP command', () => {
    const res = commandPayloadSchema.safeParse({
      type: 'DEPLOY_APP',
      spec: {
        appId: 'app_1',
        deploymentId: 'dep_1',
        containerName: 'yourstack-app_1',
        imageTag: 'yourstack/app_1:1',
        source: { kind: 'image', image: 'nginx:latest' },
        resources: { cpu: 0.5, memoryMb: 512 },
      },
    });
    expect(res.success).toBe(true);
  });
  it('rejects unknown command types', () => {
    expect(commandPayloadSchema.safeParse({ type: 'RUN_SHELL', spec: {} }).success).toBe(false);
  });
});
