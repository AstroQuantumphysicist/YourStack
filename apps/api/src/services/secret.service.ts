import type { PrismaClient } from '@noderail/db';
import type { Encryptor } from '@noderail/security';

/**
 * Resolve the effective environment for an app by layering secrets:
 * project-scope < app-scope < environment-scope (later wins). Values are
 * decrypted here and only ever leave the control plane inside a signed,
 * TLS-transported deploy command.
 */
export async function resolveEnvForApp(
  prisma: PrismaClient,
  encryptor: Encryptor,
  app: { id: string; projectId: string },
  environmentId?: string | null,
): Promise<Record<string, string>> {
  const secrets = await prisma.secret.findMany({
    where: {
      OR: [
        { scope: 'project', projectId: app.projectId },
        { scope: 'app', appId: app.id },
        ...(environmentId ? [{ scope: 'environment' as const, environmentId }] : []),
      ],
    },
    orderBy: { scope: 'asc' },
  });

  // Apply in precedence order: project -> app -> environment.
  const order: Record<string, number> = { project: 0, app: 1, environment: 2 };
  const sorted = [...secrets].sort((a, b) => order[a.scope]! - order[b.scope]!);

  const env: Record<string, string> = {};
  for (const s of sorted) {
    try {
      env[s.key] = encryptor.decrypt(s.ciphertext);
    } catch {
      // Skip undecryptable secrets rather than fail the whole deploy.
    }
  }
  return env;
}

/** Return just the secret values (for log redaction). */
export async function collectSecretValues(
  prisma: PrismaClient,
  encryptor: Encryptor,
  app: { id: string; projectId: string },
): Promise<string[]> {
  const env = await resolveEnvForApp(prisma, encryptor, app);
  return Object.values(env);
}
