import pc from 'picocolors';

/**
 * An error that carries a user-facing message and a process exit code. When a
 * command throws a `CliError`, the top-level handler prints the message (no
 * stack trace) and exits with `exitCode`.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    /** Optional hint printed on a dimmed second line. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Shape of the JSON error envelope returned by the YourStack API. */
export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

/**
 * Translate an HTTP status + parsed body into a friendly `CliError`. Centralized
 * so every command reports 401/402/403/etc. the same way.
 */
export function apiError(status: number, body: ApiErrorBody | null, url: string): CliError {
  const message = body?.error?.message;
  switch (status) {
    case 401:
      return new CliError(
        message ?? 'Not authenticated.',
        1,
        `Run ${pc.cyan('yourstack login')} to sign in with an API token.`,
      );
    case 402:
      return new CliError(
        message ?? 'Plan limit reached.',
        1,
        'Upgrade your workspace plan to continue.',
      );
    case 403:
      return new CliError(
        message ?? 'You do not have permission to perform this action.',
        1,
      );
    case 404:
      return new CliError(message ?? `Not found: ${url}`, 1);
    case 409:
      return new CliError(message ?? 'Resource already exists.', 1);
    case 422:
      return new CliError(
        message ?? 'Request validation failed.',
        1,
        formatDetails(body?.error?.details),
      );
    case 429:
      return new CliError(message ?? 'Too many requests. Slow down and try again.', 1);
    default:
      if (status >= 500) return new CliError(message ?? `Server error (${status}).`, 1);
      return new CliError(message ?? `Request failed (${status}).`, 1);
  }
}

function formatDetails(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  const lines = details
    .map((d) => {
      if (d && typeof d === 'object' && 'path' in d && 'message' in d) {
        const { path, message } = d as { path: unknown; message: unknown };
        return `  ${String(path) || '(root)'}: ${String(message)}`;
      }
      return `  ${String(d)}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}

/** Map a low-level fetch/network failure to a friendly CliError. */
export function networkError(err: unknown, apiUrl: string): CliError {
  const detail = err instanceof Error ? err.message : String(err);
  return new CliError(
    `Could not reach the YourStack API at ${apiUrl}.`,
    1,
    `${detail}\nIs the API running, and is your ${pc.cyan('--api-url')} correct?`,
  );
}
