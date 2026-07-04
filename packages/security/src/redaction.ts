import { REDACTED } from '@noderail/shared';

/**
 * Best-effort secret redaction for log lines. Given a set of secret values,
 * replace any occurrence in a message with a placeholder. Also masks common
 * token-shaped strings heuristically. This is defense-in-depth, not a guarantee.
 */
const HEURISTIC_PATTERNS: RegExp[] = [
  /\bnr[aj]?_[A-Za-z0-9_-]{16,}\b/g, // NodeRail tokens
  /\bghp_[A-Za-z0-9]{36}\b/g, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
];

export function buildRedactor(secretValues: Iterable<string>): (line: string) => string {
  const values = Array.from(secretValues)
    .filter((v) => v.length >= 4)
    .sort((a, b) => b.length - a.length); // longest first to avoid partial masks

  return (line: string): string => {
    let out = line;
    for (const v of values) {
      if (!v) continue;
      out = out.split(v).join(REDACTED);
    }
    for (const re of HEURISTIC_PATTERNS) {
      out = out.replace(re, REDACTED);
    }
    return out;
  };
}

export function redactLine(line: string, secretValues: Iterable<string> = []): string {
  return buildRedactor(secretValues)(line);
}
