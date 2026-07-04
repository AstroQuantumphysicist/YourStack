import { CliError } from './errors.js';

export interface EnvPair {
  key: string;
  value: string;
}

/** Valid env-var name, matching the API's secret key constraint. */
const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Parse a `KEY=VALUE` argument into its parts. The value may itself contain
 * `=` characters (only the first `=` is the separator) and may be empty-quoted.
 * Surrounding single or double quotes on the value are stripped.
 */
export function parseKeyValue(input: string): EnvPair {
  const eq = input.indexOf('=');
  if (eq === -1) {
    throw new CliError(
      `Invalid argument "${input}". Expected KEY=VALUE.`,
      1,
      'Example: noderail env set DATABASE_URL=postgres://…',
    );
  }
  const key = input.slice(0, eq).trim();
  let value = input.slice(eq + 1);
  if (!KEY_RE.test(key)) {
    throw new CliError(
      `Invalid secret key "${key}".`,
      1,
      'Keys must be uppercase letters, digits, and underscores (e.g. API_KEY).',
    );
  }
  // Strip a single matching pair of surrounding quotes, if present.
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (value.length === 0) {
    throw new CliError(`Secret "${key}" has an empty value.`);
  }
  return { key, value };
}
