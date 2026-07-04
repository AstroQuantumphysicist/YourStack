import { cn } from '@/lib/utils';

/**
 * Inline SVG architecture diagram: the YourStack Control Plane orchestrating
 * lightweight Agents running on the user's own servers.
 */
export function ArchitectureDiagram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 380"
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label="YourStack architecture: control plane connected to agents on your servers"
    >
      <defs>
        <linearGradient id="arch-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--accent))" />
        </linearGradient>
        <linearGradient id="arch-link" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity="0.1" />
          <stop offset="0.5" stopColor="hsl(var(--primary))" stopOpacity="0.9" />
          <stop offset="1" stopColor="hsl(var(--accent))" stopOpacity="0.1" />
        </linearGradient>
        <filter id="arch-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Control plane */}
      <g>
        <rect
          x="290"
          y="26"
          width="220"
          height="96"
          rx="16"
          fill="hsl(var(--card))"
          stroke="url(#arch-accent)"
          strokeWidth="1.5"
        />
        <circle cx="322" cy="60" r="10" fill="url(#arch-accent)" filter="url(#arch-glow)" />
        <text x="348" y="58" fill="hsl(var(--foreground))" fontSize="15" fontWeight="600">
          YourStack Control Plane
        </text>
        <text x="348" y="78" fill="hsl(var(--muted-foreground))" fontSize="11">
          API · Pipelines · Scheduler
        </text>
        <text x="348" y="96" fill="hsl(var(--muted-foreground))" fontSize="11">
          Secrets · Domains · Realtime (SSE)
        </text>
      </g>

      {/* Connection lines to nodes */}
      {[160, 400, 640].map((x, i) => (
        <path
          key={i}
          d={`M400 122 C400 180, ${x} 180, ${x} 236`}
          stroke="url(#arch-link)"
          strokeWidth="2"
          fill="none"
          strokeDasharray="5 6"
        />
      ))}

      {/* mTLS label */}
      <rect x="352" y="168" width="96" height="24" rx="12" fill="hsl(var(--surface-muted))" stroke="hsl(var(--border))" />
      <text x="400" y="184" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="11">
        signed commands
      </text>

      {/* Nodes (user's servers) */}
      {[
        { x: 90, label: 'your-vps-01', meta: 'Hetzner · 8 vCPU' },
        { x: 330, label: 'homelab-01', meta: 'Bare metal · 16GB' },
        { x: 570, label: 'edge-eu', meta: 'On-prem · Docker' },
      ].map((node) => (
        <g key={node.label}>
          <rect
            x={node.x}
            y="236"
            width="140"
            height="110"
            rx="14"
            fill="hsl(var(--surface))"
            stroke="hsl(var(--border))"
            strokeWidth="1.5"
          />
          <rect x={node.x + 16} y="252" width="28" height="28" rx="7" fill="url(#arch-accent)" opacity="0.85" />
          <text x={node.x + 52} y="266" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">
            Agent
          </text>
          <text x={node.x + 52} y="282" fill="hsl(var(--muted-foreground))" fontSize="10">
            ● online
          </text>
          <line
            x1={node.x + 16}
            y1="298"
            x2={node.x + 124}
            y2="298"
            stroke="hsl(var(--border))"
          />
          <text x={node.x + 16} y="318" fill="hsl(var(--foreground))" fontSize="12">
            {node.label}
          </text>
          <text x={node.x + 16} y="334" fill="hsl(var(--muted-foreground))" fontSize="10">
            {node.meta}
          </text>
        </g>
      ))}

      <text x="400" y="372" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="11">
        Your servers. Your data plane. Our orchestration.
      </text>
    </svg>
  );
}
