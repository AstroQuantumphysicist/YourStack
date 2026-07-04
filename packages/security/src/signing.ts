import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '@noderail/shared';

/**
 * HMAC-SHA256 signing of node commands. The control plane signs the canonical
 * JSON of the command envelope with the node's per-node command key; the agent
 * verifies before executing. This prevents a compromised transport from
 * injecting forged commands and lets the agent reject anything not signed by
 * the control plane it registered with.
 */
export interface SignableCommand {
  id: string;
  nodeId: string;
  payload: unknown;
  timeoutMs: number;
  issuedAt: string;
}

export function signCommand(command: SignableCommand, hexKey: string): string {
  const message = canonicalJson(command);
  return createHmac('sha256', Buffer.from(hexKey, 'hex')).update(message).digest('hex');
}

export function verifyCommandSignature(
  command: SignableCommand,
  signature: string,
  hexKey: string,
): boolean {
  const expected = signCommand(command, hexKey);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a GitHub webhook signature (X-Hub-Signature-256: sha256=<hex>).
 * `rawBody` MUST be the exact bytes received (not re-serialized JSON).
 */
export function verifyGithubWebhook(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected =
    'sha256=' +
    createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
      .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Generate a fresh per-node command HMAC key (hex). */
export { randomHex as generateCommandKey } from './tokens.js';
