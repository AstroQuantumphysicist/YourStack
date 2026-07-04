import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A premium empty state with an inline-SVG illustration: a gradient orbit with
 * the resource's icon at its center. Used across the managed-resource pages.
 */
export function EmptyIllustration({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="relative mb-6 h-28 w-28">
        <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="empty-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="empty-ring" x1="0" y1="0" x2="120" y2="120">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--accent))" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="58" fill="url(#empty-glow)" />
          <circle
            cx="60"
            cy="60"
            r="40"
            fill="none"
            stroke="url(#empty-ring)"
            strokeWidth="1.5"
            strokeDasharray="4 6"
            opacity="0.7"
          />
          <circle cx="60" cy="20" r="3" fill="hsl(var(--accent))" />
          <circle cx="100" cy="60" r="2.5" fill="hsl(var(--primary))" opacity="0.7" />
          <circle cx="60" cy="100" r="2" fill="hsl(var(--primary))" opacity="0.5" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-card">
            <Icon className="h-7 w-7" />
          </span>
        </span>
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
