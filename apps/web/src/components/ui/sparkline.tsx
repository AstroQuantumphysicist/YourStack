import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  max?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
}

/** Lightweight inline-SVG sparkline — no charting dependency. */
export function Sparkline({
  data,
  width = 240,
  height = 56,
  max,
  className,
  color = 'hsl(var(--primary))',
  strokeWidth = 2,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground',
          className,
        )}
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const hi = max ?? Math.max(...data, 1);
  const n = data.length;
  const stepX = n > 1 ? width / (n - 1) : width;
  const pad = strokeWidth;
  const usableH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - (Math.min(v, hi) / hi) * usableH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${Math.abs(hashData(data))}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cn('overflow-visible', className)}
      role="img"
      aria-label="sparkline"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function hashData(data: number[]): number {
  let h = 0;
  for (const v of data) h = (h * 31 + Math.round(v * 100)) | 0;
  return h;
}
