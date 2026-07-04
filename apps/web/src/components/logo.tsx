import { cn } from '@/lib/utils';

/** NodeRail mark: a stylized rail/node glyph rendered inline as SVG. */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="nr-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--accent))" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="url(#nr-logo)" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.6" fill="url(#nr-logo)" />
      <circle cx="22" cy="22" r="2.6" fill="url(#nr-logo)" />
      <path
        d="M10 12.5V19a3 3 0 0 0 3 3h6.5"
        stroke="url(#nr-logo)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="22" cy="10" r="1.4" fill="hsl(var(--accent))" opacity="0.7" />
    </svg>
  );
}

export function Wordmark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Logo size={size} />
      <span className="text-lg font-semibold tracking-tight text-foreground">NodeRail</span>
    </span>
  );
}
