import pc from 'picocolors';

/** Print a JSON value to stdout (pretty-printed). Used by `--json` output. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function info(msg: string): void {
  process.stdout.write(msg + '\n');
}

export function success(msg: string): void {
  process.stdout.write(`${pc.green('✔')} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${pc.yellow('!')} ${msg}\n`);
}

export function errorLine(msg: string): void {
  process.stderr.write(`${pc.red('✖')} ${msg}\n`);
}

export function dim(msg: string): string {
  return pc.dim(msg);
}

/** Colorize a status string with a sensible traffic-light scheme. */
export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['running', 'online', 'succeeded', 'active', 'verified'].includes(s)) return pc.green(status);
  if (['failed', 'offline', 'error', 'canceled'].includes(s)) return pc.red(status);
  if (['building', 'deploying', 'queued', 'pending', 'verifying', 'draining', 'degraded'].includes(s))
    return pc.yellow(status);
  return pc.dim(status);
}

export interface Column<T> {
  header: string;
  value: (row: T) => string;
}

/**
 * Render an aligned, monospace-friendly table. Column widths are computed from
 * the widest visible cell, ignoring ANSI color codes.
 */
export function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return pc.dim('(none)');
  const cells = rows.map((r) => columns.map((c) => c.value(r)));
  const widths = columns.map((c, i) =>
    Math.max(visibleLength(c.header), ...cells.map((row) => visibleLength(row[i] ?? ''))),
  );

  const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - visibleLength(text)));
  const headerLine = columns.map((c, i) => pc.bold(pad(c.header, widths[i]!))).join('  ');
  const bodyLines = cells.map((row) => row.map((cell, i) => pad(cell, widths[i]!)).join('  '));
  return [headerLine, ...bodyLines].join('\n');
}

// Strip ANSI escape codes to measure the printed width of a cell.
const ANSI = /\[[0-9;]*m/g;
function visibleLength(text: string): number {
  return text.replace(ANSI, '').length;
}

/** Human-friendly relative time (e.g. "3m ago"). Accepts an ISO string. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return pc.dim('—');
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return pc.dim('—');
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
