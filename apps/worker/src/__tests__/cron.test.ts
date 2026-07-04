import { describe, expect, it } from 'vitest';
import { cronSchedulerId, isFireJob, splitCommand } from '../processors/cron.js';

describe('splitCommand', () => {
  it('splits a command string into argv by whitespace', () => {
    expect(splitCommand('node dist/task.js --flush')).toEqual(['node', 'dist/task.js', '--flush']);
  });

  it('collapses runs of whitespace and trims', () => {
    expect(splitCommand('  echo   hello\tworld  ')).toEqual(['echo', 'hello', 'world']);
  });

  it('returns undefined for empty/absent commands so the image CMD runs', () => {
    expect(splitCommand(null)).toBeUndefined();
    expect(splitCommand(undefined)).toBeUndefined();
    expect(splitCommand('')).toBeUndefined();
    expect(splitCommand('   ')).toBeUndefined();
  });
});

describe('isFireJob', () => {
  it('is true only when fire === true', () => {
    expect(isFireJob({ cronJobId: 'c1', fire: true })).toBe(true);
    expect(isFireJob({ cronJobId: 'c1' })).toBe(false);
    expect(isFireJob({ cronJobId: 'c1', fire: false })).toBe(false);
    expect(isFireJob(null)).toBe(false);
    expect(isFireJob('fire')).toBe(false);
  });
});

describe('cronSchedulerId', () => {
  it('derives a stable scheduler id from the cron id', () => {
    expect(cronSchedulerId('abc123')).toBe('cron:abc123');
  });
});
