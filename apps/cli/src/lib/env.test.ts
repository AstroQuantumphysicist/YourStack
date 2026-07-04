import { describe, expect, it } from 'vitest';
import { parseKeyValue } from './env.js';
import { CliError } from './errors.js';

describe('parseKeyValue', () => {
  it('splits a simple KEY=VALUE', () => {
    expect(parseKeyValue('API_KEY=secret')).toEqual({ key: 'API_KEY', value: 'secret' });
  });

  it('keeps = characters inside the value', () => {
    expect(parseKeyValue('DATABASE_URL=postgres://u:p@h/db?ssl=true')).toEqual({
      key: 'DATABASE_URL',
      value: 'postgres://u:p@h/db?ssl=true',
    });
  });

  it('strips a single pair of surrounding quotes', () => {
    expect(parseKeyValue('TOKEN="ab=cd"')).toEqual({ key: 'TOKEN', value: 'ab=cd' });
    expect(parseKeyValue("TOKEN='xyz'")).toEqual({ key: 'TOKEN', value: 'xyz' });
  });

  it('rejects input without =', () => {
    expect(() => parseKeyValue('NOPE')).toThrow(CliError);
  });

  it('rejects lowercase / invalid keys', () => {
    expect(() => parseKeyValue('lower=1')).toThrow(CliError);
    expect(() => parseKeyValue('1BAD=1')).toThrow(CliError);
  });

  it('rejects an empty value', () => {
    expect(() => parseKeyValue('EMPTY=')).toThrow(CliError);
  });
});
