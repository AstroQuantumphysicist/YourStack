import { describe, expect, it } from 'vitest';
import { slugify, encodeCursor, decodeCursor, todayKey } from '../lib/util.js';
import { AppError, Errors } from '../lib/errors.js';

describe('slugify', () => {
  it('normalizes names', () => {
    expect(slugify('My Cool App!')).toBe('my-cool-app');
    expect(slugify('  Trailing  ')).toBe('trailing');
    expect(slugify('')).toBe('item');
  });
});

describe('cursor', () => {
  it('round-trips ids', () => {
    const c = encodeCursor('abc123');
    expect(decodeCursor(c)).toEqual({ id: 'abc123' });
    expect(decodeCursor(undefined)).toBeUndefined();
  });
});

describe('errors', () => {
  it('constructs typed AppErrors', () => {
    const e = Errors.forbidden('nope');
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe('forbidden');
  });
});

describe('todayKey', () => {
  it('is YYYY-MM-DD', () => {
    expect(todayKey(new Date('2026-07-04T12:00:00Z'))).toBe('2026-07-04');
  });
});
