import { describe, expect, it } from 'vitest';
import { bucketTimestamp } from '../services/metrics.service.js';
import { allocatePort } from '../services/placement.service.js';

describe('bucketTimestamp', () => {
  it('rounds down to the step boundary', () => {
    const d = new Date('2026-07-04T12:00:37.500Z');
    expect(bucketTimestamp(d, 60).toISOString()).toBe('2026-07-04T12:00:00.000Z');
    expect(bucketTimestamp(d, 30).toISOString()).toBe('2026-07-04T12:00:30.000Z');
    expect(bucketTimestamp(d, 15).toISOString()).toBe('2026-07-04T12:00:30.000Z');
  });
});

describe('allocatePort', () => {
  it('is deterministic and in range', () => {
    const a = allocatePort('db-proj-mydb');
    const b = allocatePort('db-proj-mydb');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(20000);
    expect(a).toBeLessThan(40000);
  });
  it('differs for different seeds', () => {
    expect(allocatePort('a')).not.toBe(allocatePort('b'));
  });
});
