import { describe, expect, it } from 'vitest';
import { Encryptor } from '../encryption.js';
import { hashPassword, verifyPassword } from '../password.js';
import { generateApiToken, verifyToken, hashToken } from '../tokens.js';
import { signCommand, verifyCommandSignature, verifyGithubWebhook } from '../signing.js';
import { redactLine } from '../redaction.js';
import { createHmac } from 'node:crypto';

const KEY = 'a'.repeat(64);

describe('Encryptor', () => {
  it('round-trips', () => {
    const e = new Encryptor(KEY);
    const ct = e.encrypt('super-secret-value');
    expect(ct).not.toContain('super-secret-value');
    expect(e.decrypt(ct)).toBe('super-secret-value');
  });
  it('rejects tampered ciphertext', () => {
    const e = new Encryptor(KEY);
    const ct = e.encrypt('x');
    const parts = ct.split(':');
    parts[3] = parts[3]!.slice(0, -2) + 'ff';
    expect(() => e.decrypt(parts.join(':'))).toThrow();
  });
});

describe('passwords', () => {
  it('verifies correct and rejects wrong', async () => {
    const h = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('tokens', () => {
  it('generates verifiable tokens', () => {
    const t = generateApiToken();
    expect(t.plaintext.startsWith('ys_')).toBe(true);
    expect(verifyToken(t.plaintext, t.hash)).toBe(true);
    expect(verifyToken('ys_wrong', t.hash)).toBe(false);
    expect(hashToken(t.plaintext)).toBe(t.hash);
  });
});

describe('command signing', () => {
  const cmd = { id: 'c1', nodeId: 'n1', payload: { type: 'STOP_APP' }, timeoutMs: 1000, issuedAt: '2026-01-01T00:00:00Z' };
  it('signs and verifies', () => {
    const sig = signCommand(cmd, KEY);
    expect(verifyCommandSignature(cmd, sig, KEY)).toBe(true);
  });
  it('rejects tampered command', () => {
    const sig = signCommand(cmd, KEY);
    expect(verifyCommandSignature({ ...cmd, timeoutMs: 2000 }, sig, KEY)).toBe(false);
  });
});

describe('github webhook', () => {
  it('verifies a valid signature', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const secret = 'whsecret';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyGithubWebhook(body, sig, secret)).toBe(true);
    expect(verifyGithubWebhook(body, 'sha256=deadbeef', secret)).toBe(false);
  });
});

describe('redaction', () => {
  it('masks known secret values and heuristic tokens', () => {
    const out = redactLine('token is ys_ABCDEFGHIJKLMNOPQRSTUVWX and pw=topsecret', ['topsecret']);
    expect(out).not.toContain('topsecret');
    expect(out).not.toContain('ys_ABCDEFGHIJKLMNOPQRSTUVWX');
  });
});
