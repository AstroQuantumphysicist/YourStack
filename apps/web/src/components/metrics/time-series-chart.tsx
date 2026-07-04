'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RenderSeries } from '@/lib/metrics';
import { metaFor } from '@/lib/metrics';
import { cn } from '@/lib/utils';

interface TimeSeriesChartProps {
  series: RenderSeries[];
  height?: number;
  /** Show left value axis + bottom time axis. */
  axes?: boolean;
  /** Fill the area beneath lines with a gradient (best for a single series). */
  area?: boolean;
  /** Force the y-axis maximum (e.g. 100 for a percentage). */
  yMax?: number;
  className?: string;
  /** Compact mode: fewer ticks, tighter padding (for small cards). */
  compact?: boolean;
}

interface Hover {
  x: number;
  t: number;
}

const AXIS_COLOR = 'hsl(var(--muted-foreground) / 0.5)';
const GRID_COLOR = 'hsl(var(--border) / 0.6)';

/**
 * Dependency-light, crisp inline-SVG time-series chart. Renders one or more
 * series (that share a unit) as smooth area/line marks with grid, axes and a
 * hover crosshair + tooltip. Responsive, light/dark aware, and cheap enough to
 * re-render on every live SSE append.
 */
export function TimeSeriesChart({
  series,
  height = 200,
  axes = true,
  area,
  yMax: forcedMax,
  className,
  compact = false,
}: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<Hover | null>(null);
  const uid = useId().replace(/[:]/g, '');

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth || 560);
    return () => ro.disconnect();
  }, []);

  const nonEmpty = series.filter((s) => s.points.length > 0);
  const showArea = area ?? nonEmpty.length <= 1;

  const padL = axes ? (compact ? 34 : 44) : 2;
  const padR = 6;
  const padT = 8;
  const padB = axes ? 22 : 4;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);

  const domain = useMemo(() => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMax = 0;
    for (const s of nonEmpty) {
      for (const p of s.points) {
        if (p.t < tMin) tMin = p.t;
        if (p.t > tMax) tMax = p.t;
        if (p.v > vMax) vMax = p.v;
      }
    }
    if (!Number.isFinite(tMin)) {
      tMin = Date.now() - 3600_000;
      tMax = Date.now();
    }
    if (tMax === tMin) tMax = tMin + 1;
    const top = forcedMax ?? niceMax(vMax);
    return { tMin, tMax, vMax: top <= 0 ? 1 : top };
  }, [nonEmpty, forcedMax]);

  const xOf = (t: number) => padL + ((t - domain.tMin) / (domain.tMax - domain.tMin)) * innerW;
  const yOf = (v: number) => padT + innerH - (Math.min(v, domain.vMax) / domain.vMax) * innerH;

  const meta = nonEmpty[0] ? metaFor(nonEmpty[0].kind) : null;
  const yTicks = useMemo(() => {
    const count = compact ? 3 : 4;
    return Array.from({ length: count + 1 }, (_, i) => (domain.vMax / count) * i);
  }, [domain.vMax, compact]);

  const xTicks = useMemo(() => {
    const count = compact ? 3 : 5;
    return Array.from({ length: count + 1 }, (_, i) => domain.tMin + ((domain.tMax - domain.tMin) / count) * i);
  }, [domain.tMin, domain.tMax, compact]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < padL || px > width - padR) {
      setHover(null);
      return;
    }
    const t = domain.tMin + ((px - padL) / innerW) * (domain.tMax - domain.tMin);
    setHover({ x: px, t });
  };

  const hoverValues = useMemo(() => {
    if (!hover) return [];
    return nonEmpty.map((s) => ({ series: s, point: nearest(s.points, hover.t) }));
  }, [hover, nonEmpty]);

  const hasData = nonEmpty.length > 0;

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {!hasData ? (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground"
          style={{ height }}
        >
          No data in this window yet
        </div>
      ) : (
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="time series chart"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="touch-none"
        >
          <defs>
            {nonEmpty.map((s) => (
              <linearGradient key={s.kind} id={`grad-${uid}-${s.kind}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={showArea ? 0.28 : 0.18} />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* horizontal grid + y labels */}
          {yTicks.map((v, i) => {
            const y = yOf(v);
            return (
              <g key={i}>
                <line x1={padL} x2={width - padR} y1={y} y2={y} stroke={GRID_COLOR} strokeWidth={1} shapeRendering="crispEdges" />
                {axes ? (
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS_COLOR}>
                    {meta ? meta.format(v) : Math.round(v)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* x axis labels */}
          {axes
            ? xTicks.map((t, i) => {
                const x = xOf(t);
                if (i === 0 || i === xTicks.length - 1) {
                  // avoid clipping at edges
                }
                return (
                  <text
                    key={i}
                    x={Math.min(Math.max(x, padL + 12), width - padR - 12)}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill={AXIS_COLOR}
                  >
                    {fmtTime(t, domain.tMax - domain.tMin)}
                  </text>
                );
              })
            : null}

          {/* series marks */}
          {nonEmpty.map((s) => {
            const line = buildPath(s.points, xOf, yOf);
            const areaPath = `${line} L${xOf(s.points[s.points.length - 1]!.t).toFixed(1)},${(padT + innerH).toFixed(1)} L${xOf(s.points[0]!.t).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
            return (
              <g key={s.kind}>
                {showArea ? <path d={areaPath} fill={`url(#grad-${uid}-${s.kind})`} /> : null}
                <path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {/* hover crosshair */}
          {hover ? (
            <g>
              <line
                x1={hover.x}
                x2={hover.x}
                y1={padT}
                y2={padT + innerH}
                stroke="hsl(var(--muted-foreground) / 0.6)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {hoverValues.map(({ series: s, point }) =>
                point ? (
                  <circle
                    key={s.kind}
                    cx={xOf(point.t)}
                    cy={yOf(point.v)}
                    r={3.5}
                    fill="hsl(var(--background))"
                    stroke={s.color}
                    strokeWidth={2}
                  />
                ) : null,
              )}
            </g>
          ) : null}
        </svg>
      )}

      {/* tooltip */}
      {hover && hoverValues.length > 0 ? (
        <div
          className="glass pointer-events-none absolute z-10 min-w-[9rem] -translate-y-2 rounded-lg border border-border p-2 shadow-card"
          style={{
            left: Math.min(Math.max(hover.x + 10, 8), Math.max(8, width - 150)),
            top: 6,
          }}
        >
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {fmtFull(hover.t)}
          </p>
          <div className="space-y-1">
            {hoverValues.map(({ series: s, point }) => (
              <div key={s.kind} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {point ? metaFor(s.kind).format(point.v) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildPath(
  points: { t: number; v: number }[],
  xOf: (t: number) => number,
  yOf: (v: number) => number,
): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`)
    .join(' ');
}

function nearest(points: { t: number; v: number }[], t: number): { t: number; v: number } | null {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  const cand = points[lo]!;
  const prev = points[lo - 1];
  if (prev && Math.abs(prev.t - t) < Math.abs(cand.t - t)) return prev;
  return cand;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  if (v <= 1) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function fmtTime(t: number, span: number): string {
  const d = new Date(t);
  if (span > 12 * 3600_000) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtFull(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
