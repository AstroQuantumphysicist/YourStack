import { describe, expect, it } from 'vitest';
import { normalizePrivateKey } from '../lib/github.js';
import {
  engineFromSlug,
  resolveTemplateVariables,
  templateVariableDTOs,
  type TemplateSpec,
} from '../services/template.service.js';

describe('normalizePrivateKey', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJ\n-----END RSA PRIVATE KEY-----';

  it('passes through a raw PEM unchanged', () => {
    expect(normalizePrivateKey(pem)).toBe(pem);
  });

  it('un-escapes literal \\n newlines from single-line env vars', () => {
    const escaped = pem.replace(/\n/g, '\\n');
    expect(normalizePrivateKey(escaped)).toBe(pem);
  });

  it('decodes a base64-encoded PEM', () => {
    const encoded = Buffer.from(pem, 'utf8').toString('base64');
    expect(normalizePrivateKey(encoded)).toBe(pem);
  });
});

describe('engineFromSlug', () => {
  it('prefers an explicit spec.engine', () => {
    expect(engineFromSlug('anything', { engine: 'mysql' })).toBe('mysql');
  });

  it('matches known engine tokens (and aliases) in the slug', () => {
    expect(engineFromSlug('postgres-16')).toBe('postgres');
    expect(engineFromSlug('pg-lite')).toBe('postgres');
    expect(engineFromSlug('redis-stack')).toBe('redis');
    expect(engineFromSlug('valkey')).toBe('redis');
    expect(engineFromSlug('mongo-latest')).toBe('mongodb');
    expect(engineFromSlug('mariadb')).toBe('mysql');
  });

  it('returns null for non-database slugs', () => {
    expect(engineFromSlug('grafana')).toBeNull();
  });
});

describe('resolveTemplateVariables', () => {
  const spec: TemplateSpec = {
    variables: [
      { key: 'PUBLIC_URL', default: 'http://localhost' },
      { key: 'ADMIN_PASSWORD', generate: 'password' },
      { key: 'API_TOKEN', generate: 'token', secret: true },
      { key: 'REQUIRED_VAR', required: true },
    ],
  };

  it('applies overrides, defaults, and generation; flags secrets', () => {
    const { values, secretKeys } = resolveTemplateVariables(spec, {
      REQUIRED_VAR: 'provided',
      PUBLIC_URL: 'https://example.com',
    });
    expect(values.PUBLIC_URL).toBe('https://example.com');
    expect(values.REQUIRED_VAR).toBe('provided');
    expect(values.ADMIN_PASSWORD).toBeTruthy();
    expect(values.API_TOKEN).toBeTruthy();
    expect(secretKeys.has('ADMIN_PASSWORD')).toBe(true);
    expect(secretKeys.has('API_TOKEN')).toBe(true);
    expect(secretKeys.has('PUBLIC_URL')).toBe(false);
  });

  it('throws when a required variable is missing', () => {
    expect(() => resolveTemplateVariables(spec, {})).toThrow(/REQUIRED_VAR/);
  });
});

describe('templateVariableDTOs', () => {
  it('never exposes secret/generated defaults', () => {
    const dtos = templateVariableDTOs({
      variables: [
        { key: 'PLAIN', default: 'visible' },
        { key: 'SECRET', default: 'hidden', secret: true },
        { key: 'GEN', default: 'nope', generate: 'password' },
      ],
    });
    expect(dtos.find((d) => d.key === 'PLAIN')?.default).toBe('visible');
    expect(dtos.find((d) => d.key === 'SECRET')?.default).toBeNull();
    expect(dtos.find((d) => d.key === 'SECRET')?.secret).toBe(true);
    expect(dtos.find((d) => d.key === 'GEN')?.default).toBeNull();
    expect(dtos.find((d) => d.key === 'GEN')?.secret).toBe(true);
  });
});
