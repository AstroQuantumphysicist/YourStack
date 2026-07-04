import pc from 'picocolors';

/** A realtime log payload as published on SSE `log.build` / `log.runtime`. */
export interface LogPayload {
  severity?: string;
  message?: string;
  timestamp?: string;
}

/** Format a log payload into a single colorized, timestamped line. */
export function formatLogLine(raw: unknown): string {
  const p = (raw ?? {}) as LogPayload;
  const ts = p.timestamp ? pc.dim(formatTime(p.timestamp)) : '';
  const sev = severityTag(p.severity);
  const msg = p.message ?? '';
  return [ts, sev, msg].filter(Boolean).join(' ');
}

function severityTag(severity?: string): string {
  switch ((severity ?? 'info').toLowerCase()) {
    case 'error':
      return pc.red('ERROR');
    case 'warn':
      return pc.yellow('WARN ');
    case 'debug':
      return pc.dim('DEBUG');
    default:
      return pc.blue('INFO ');
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
