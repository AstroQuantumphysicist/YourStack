'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

const LABELS: Record<string, string> = {
  dashboard: 'Overview',
  apps: 'Apps',
  functions: 'Functions',
  data: 'Databases',
  storage: 'Storage',
  nodes: 'Nodes',
  regions: 'Regions',
  builder: 'Builder',
  firewalls: 'Firewalls',
  'load-balancers': 'Load Balancers',
  organization: 'Organization',
  deployments: 'Deployments',
  cicd: 'CI/CD',
  runners: 'Runners',
  domains: 'Domains',
  metrics: 'Metrics',
  secrets: 'Secrets',
  settings: 'Settings',
  admin: 'Admin',
};

/** Derives a breadcrumb trail from the current path. IDs render as a short id. */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Build cumulative crumbs, skipping the leading "dashboard" duplicate label.
  const crumbs: Array<{ label: string; href: string }> = [];
  let href = '';
  segments.forEach((seg, i) => {
    href += `/${seg}`;
    const known = LABELS[seg];
    const isId = !known && /[0-9a-f-]{8,}|^c[a-z0-9]{10,}$/i.test(seg);
    const label = known ?? (isId ? `${seg.slice(0, 8)}…` : seg.replace(/-/g, ' '));
    // Collapse the root: the first segment ("dashboard") is home.
    if (i === 0) {
      crumbs.push({ label: 'Overview', href: '/dashboard' });
    } else {
      crumbs.push({ label, href });
    }
  });

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={c.href}>
            {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" /> : null}
            {last ? (
              <span className="font-medium text-foreground">{c.label}</span>
            ) : (
              <Link href={c.href} className="capitalize text-muted-foreground transition-colors hover:text-foreground">
                {c.label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
