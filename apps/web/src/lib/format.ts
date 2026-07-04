/** Presentation helpers shared across the dashboard. */

export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateFull(input: string | number | Date | null | undefined): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** "3m ago", "2h ago", "just now" style relative time. */
export function timeAgo(input: string | number | Date | null | undefined): string {
  if (!input) return 'never';
  const d = new Date(input);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return 'never';
  const s = Math.round(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function formatMb(mb: number | null | undefined): string {
  if (mb == null) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatPercent(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v)}%`;
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function truncate(s: string, n = 8): string {
  if (!s) return s;
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length <= 10 ? id : id.slice(0, 8);
}
