import {
  CONTAINER_PREFIX,
  DOCKER_LABEL_NAMESPACE,
  type DeployAppSpec,
  type DeploySource,
} from '@yourstack/shared';
import type { App, Deployment, GitRepository } from '@yourstack/db';
import type { WorkerContext } from '../context.js';
import { resolveEnvForApp } from './secrets.js';

const DEMO_FALLBACK_IMAGE = 'traefik/whoami:latest';

export interface BuildSpecArgs {
  app: App;
  deployment: Deployment;
  repo: GitRepository | null;
}

/**
 * Translate an app + deployment into a fully-resolved DeployAppSpec the agent
 * can execute. Chooses the build source (git Dockerfile / buildpack / prebuilt
 * image), injects decrypted secrets, and attaches healthcheck + resource limits.
 */
export async function buildDeploySpec(ctx: WorkerContext, args: BuildSpecArgs): Promise<DeployAppSpec> {
  const { app, deployment, repo } = args;
  const containerName = `${CONTAINER_PREFIX}-${app.id}`;
  const imageTag = `${CONTAINER_PREFIX}/${app.id}:${deployment.version}`;
  const ref = deployment.ref ?? app.branch;

  const env = await resolveEnvForApp(ctx.prisma, ctx.encryptor, app);
  // Provide the app's own PORT so buildpack runtimes bind correctly.
  env.PORT = env.PORT ?? String(app.port);
  env.NODE_ENV = env.NODE_ENV ?? 'production';

  const source = resolveSource(app, repo, ref, ctx);

  // Attach a verified/active primary domain if one exists.
  const domain = await ctx.prisma.domain.findFirst({
    where: { appId: app.id, status: { in: ['verified', 'active'] } },
    orderBy: { createdAt: 'asc' },
  });

  const spec: DeployAppSpec = {
    appId: app.id,
    deploymentId: deployment.id,
    containerName,
    imageTag,
    source,
    env,
    ports: [{ containerPort: app.port, protocol: 'tcp' }],
    resources: { cpu: app.cpu, memoryMb: app.memoryMb },
    healthcheck: {
      path: app.healthcheckPath,
      port: app.port,
      timeoutMs: 10_000,
      retries: 5,
      intervalMs: 3_000,
      expectStatus: 200,
    },
    domain: domain
      ? { domain: domain.hostname, autoHttps: domain.autoHttps, targetPort: app.port }
      : undefined,
    strategy: app.deploymentStrategy,
    networkName: `${CONTAINER_PREFIX}_${app.id}`,
    labels: {
      [`${DOCKER_LABEL_NAMESPACE}.app`]: app.id,
      [`${DOCKER_LABEL_NAMESPACE}.deployment`]: deployment.id,
      [`${DOCKER_LABEL_NAMESPACE}.version`]: String(deployment.version),
      [`${DOCKER_LABEL_NAMESPACE}.managed`]: 'true',
    },
  };
  return spec;
}

function resolveSource(
  app: App,
  repo: GitRepository | null,
  ref: string,
  ctx: WorkerContext,
): DeploySource {
  const cloneToken =
    repo?.installToken ? safeDecrypt(ctx, repo.installToken) : undefined;
  const repoUrl = repo
    ? `https://github.com/${repo.fullName}.git`
    : app.repoUrl && /^https?:\/\//.test(app.repoUrl)
      ? app.repoUrl
      : null;

  if (repoUrl) {
    if (app.framework === 'dockerfile' || !app.framework) {
      return { kind: 'git', repoUrl, ref, contextPath: '.', dockerfile: 'Dockerfile', cloneToken };
    }
    return {
      kind: 'buildpack',
      repoUrl,
      ref,
      framework: app.framework as 'nextjs' | 'node' | 'python' | 'static',
      installCommand: app.installCommand ?? undefined,
      buildCommand: app.buildCommand ?? undefined,
      startCommand: app.startCommand ?? undefined,
      cloneToken,
    };
  }

  // No git source: treat repoUrl as an image ref if it looks like one, else demo.
  const image =
    app.repoUrl && !/^https?:\/\//.test(app.repoUrl) ? app.repoUrl : DEMO_FALLBACK_IMAGE;
  return { kind: 'image', image };
}

function safeDecrypt(ctx: WorkerContext, ciphertext: string): string | undefined {
  try {
    return ctx.encryptor.decrypt(ciphertext);
  } catch {
    return undefined;
  }
}
