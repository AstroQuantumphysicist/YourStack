import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  AGENT_TOKEN_BYTES,
  AGENT_TOKEN_PREFIX,
  API_TOKEN_BYTES,
  API_TOKEN_PREFIX,
  JOIN_TOKEN_BYTES,
  JOIN_TOKEN_PREFIX,
} from '@noderail/shared';

/** URL-safe base64 without padding. */
function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export interface GeneratedToken {
  /** The full plaintext token shown to the user/agent exactly once. */
  plaintext: string;
  /** SHA-256 hex hash stored in the database. Never store plaintext. */
  hash: string;
  /** Last 4 chars for display (e.g. token list UI). */
  lastFour: string;
}

function make(prefix: string, bytes: number): GeneratedToken {
  const raw = b64url(randomBytes(bytes));
  const plaintext = `${prefix}${raw}`;
  return {
    plaintext,
    hash: hashToken(plaintext),
    lastFour: plaintext.slice(-4),
  };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyToken(plaintext: string, storedHash: string): boolean {
  const presented = Buffer.from(hashToken(plaintext), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

export const generateJoinToken = () => make(JOIN_TOKEN_PREFIX, JOIN_TOKEN_BYTES);
export const generateAgentToken = () => make(AGENT_TOKEN_PREFIX, AGENT_TOKEN_BYTES);
export const generateApiToken = () => make(API_TOKEN_PREFIX, API_TOKEN_BYTES);

/** Random hex string, e.g. for verification tokens / nonces. */
export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/** Random id with an optional prefix (used for domain verification tokens). */
export function randomToken(bytes = 24): string {
  return b64url(randomBytes(bytes));
}
