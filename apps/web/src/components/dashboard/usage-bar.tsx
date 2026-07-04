import { cn } from '@/lib/utils';

export function UsageBar({
  label,
  used,
  total,
  unit,
  format,
}: {
  label: string;
  used: number | null | undefined;
  total: number | null | undefined;
  unit?: string;
  format?: (n: number) => string;
}) {
  const pct =
    total && total > 0 && used != null ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const color =
    pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-primary';
  const fmt = format ?? ((n: number) => `${Math.round(n)}${unit ?? ''}`);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {used != null && total != null ? `${fmt(used)} / ${fmt(total)}` : '—'}
          <span className="ml-1 text-muted-foreground">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
