import type { FastifyRequest } from 'fastify';
import { hashToken, generateApiToken, verifyToken } from '@yourstack/security';
import type { PrismaClient, User } from '@yourstack/db';
import { Errors } from './errors.js';

export const SESSION_COOKIE = 'ys_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
}

/** Create a session row and return the raw cookie token (store hash only). */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  // Reuse the token generator to mint a session token (opaque, hashed at rest).
  const { plaintext } = generateApiToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(plaintext),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt,
    },
  });
  return { token: plaintext, expiresAt };
}

export async function resolveSessionUser(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<User | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

/** Resolve a user from a Bearer API token (for CLI / CI). Updates lastUsedAt. */
export async function resolveApiTokenUser(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<User | null> {
  if (!token || !token.startsWith('ys_')) return null;
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!record || record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  if (!verifyToken(token, record.tokenHash)) return null;
  await prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  return record.user;
}

export async function destroySession(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw Errors.unauthorized();
  return req.user;
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}
