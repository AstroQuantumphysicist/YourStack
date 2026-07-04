import { cn } from '@/lib/utils';

/** Brand-ish colors for each database engine (stylized, not official logos). */
const ENGINE_STYLE: Record<string, { bg: string; fg: string; label: string; glyph: string }> = {
  postgres: { bg: '#31648910', fg: '#4a86c5', label: 'Postgres', glyph: 'Pg' },
  mysql: { bg: '#00758f10', fg: '#12a0c0', label: 'MySQL', glyph: 'My' },
  redis: { bg: '#dc382d10', fg: '#e5544b', label: 'Redis', glyph: 'Re' },
  mongodb: { bg: '#47a24810', fg: '#4fbf50', label: 'MongoDB', glyph: 'Mo' },
};

export function EngineBadge({
  engine,
  size = 28,
  className,
}: {
  engine: string;
  size?: number;
  className?: string;
}) {
  const s = ENGINE_STYLE[engine] ?? { bg: 'hsl(var(--muted))', fg: 'hsl(var(--foreground))', label: engine, glyph: engine.slice(0, 2) };
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg border border-border font-semibold', className)}
      style={{ width: size, height: size, backgroundColor: s.bg, color: s.fg, fontSize: size * 0.36 }}
      title={s.label}
      aria-hidden
    >
      {s.glyph}
    </span>
  );
}

/** Runtime marks for serverless functions. */
const RUNTIME_STYLE: Record<string, { fg: string; label: string; glyph: string }> = {
  node20: { fg: '#4fbf50', label: 'Node 20', glyph: 'JS' },
  python311: { fg: '#4a86c5', label: 'Python 3.11', glyph: 'Py' },
  go122: { fg: '#12a0c0', label: 'Go 1.22', glyph: 'Go' },
  bun1: { fg: '#e5b04b', label: 'Bun 1', glyph: 'Bu' },
};

export function RuntimeBadge({
  runtime,
  size = 28,
  className,
}: {
  runtime: string;
  size?: number;
  className?: string;
}) {
  const s = RUNTIME_STYLE[runtime] ?? { fg: 'hsl(var(--foreground))', label: runtime, glyph: runtime.slice(0, 2) };
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted font-semibold', className)}
      style={{ width: size, height: size, color: s.fg, fontSize: size * 0.34 }}
      title={s.label}
      aria-hidden
    >
      {s.glyph}
    </span>
  );
}

export function runtimeLabel(runtime: string): string {
  return RUNTIME_STYLE[runtime]?.label ?? runtime;
}

export function engineLabel(engine: string): string {
  return ENGINE_STYLE[engine]?.label ?? engine;
}
