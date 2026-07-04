'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

/**
 * A labeled read-only field for connection info / credentials. Secret values
 * are masked until revealed and can be copied without ever displaying them.
 */
export function RevealField({
  label,
  value,
  secret = false,
  mono = true,
  className,
}: {
  label: string;
  value: string | null | undefined;
  secret?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(!secret);
  const has = value != null && value !== '';
  const display = !has ? '—' : shown ? value! : '•'.repeat(Math.min(28, Math.max(8, value!.length)));

  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm text-foreground',
            mono && 'font-mono text-[13px]',
          )}
          title={shown && has ? value! : undefined}
        >
          {display}
        </span>
        {secret && has ? (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={shown ? 'Hide value' : 'Reveal value'}
          >
            {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        {has ? <CopyButton value={value!} className="shrink-0" /> : null}
      </div>
    </div>
  );
}
