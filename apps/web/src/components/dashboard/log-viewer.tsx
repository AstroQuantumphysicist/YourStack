'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface LogLine {
  id: string;
  message: string;
  severity?: string;
  stream?: string;
  timestamp?: string;
}

const severityColor: Record<string, string> = {
  error: 'text-danger',
  warn: 'text-warning',
  warning: 'text-warning',
  debug: 'text-muted-foreground',
  info: 'text-foreground/90',
};

export function LogViewer({
  lines,
  live,
  emptyText = 'No logs yet.',
  className,
  height = 'h-[420px]',
}: {
  lines: LogLine[];
  live?: boolean;
  emptyText?: string;
  className?: string;
  height?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Track whether the user is scrolled to the bottom; only auto-scroll if so.
  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-[hsl(224_44%_3%)]',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        {live ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-success" />
            live
          </span>
        ) : null}
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className={cn('overflow-y-auto p-3 font-mono text-xs', height)}
      >
        {lines.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="log-line flex gap-2 py-0.5">
              {l.timestamp ? (
                <span className="shrink-0 select-none text-muted-foreground/60">
                  {new Date(l.timestamp).toLocaleTimeString()}
                </span>
              ) : null}
              {l.stream ? (
                <span className="shrink-0 select-none uppercase text-primary/70">{l.stream}</span>
              ) : null}
              <span className={cn('whitespace-pre-wrap break-words', severityColor[l.severity ?? 'info'])}>
                {l.message}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
