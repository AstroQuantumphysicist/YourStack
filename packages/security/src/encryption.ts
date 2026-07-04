import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM authenticated encryption for secrets at rest.
 * The stored ciphertext format is: v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * The 32-byte key comes from SECRETS_ENCRYPTION_KEY (64 hex chars).
 */
const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export class Encryptor {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error('Encryption key must be 64 hex characters (32 bytes)');
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Malformed ciphertext');
    }
    const [, ivHex, tagHex, ctHex] = parts as [string, string, string, string];
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  }
}

/** Convenience factory reading the key from the environment. */
export function createEncryptor(hexKey: string): Encryptor {
  return new Encryptor(hexKey);
}
