import type { Encryptor } from '@yourstack/security';
import type { PrismaClient } from '@yourstack/db';

/** Resolve+decrypt the effective env for an app (project < app < environment). */
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
  });
  const order: Record<string, number> = { project: 0, app: 1, environment: 2 };
  const sorted = [...secrets].sort((a, b) => order[a.scope]! - order[b.scope]!);
  const env: Record<string, string> = {};
  for (const s of sorted) {
    try {
      env[s.key] = encryptor.decrypt(s.ciphertext);
    } catch {
      /* skip undecryptable */
    }
  }
  return env;
}
