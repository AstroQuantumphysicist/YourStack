import {
  Boxes,
  Building2,
  Clock,
  Database,
  FunctionSquare,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LineChart,
  Map,
  Network,
  Rocket,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Store,
  Container,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only show for platform admins. */
  adminOnly?: boolean;
}

export interface NavSection {
  /** Section heading (omitted for the first, header-less group). */
  title?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    title: 'Build',
    items: [
      { href: '/dashboard/marketplace', label: 'Marketplace', icon: Store },
      { href: '/dashboard/apps', label: 'Apps', icon: Boxes },
      { href: '/dashboard/functions', label: 'Functions', icon: FunctionSquare },
      { href: '/dashboard/cron', label: 'Cron Jobs', icon: Clock },
    ],
  },
  {
    title: 'Data',
    items: [
      { href: '/dashboard/data', label: 'Databases', icon: Database },
      { href: '/dashboard/storage', label: 'Storage', icon: HardDrive },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { href: '/dashboard/nodes', label: 'Nodes', icon: Server },
      { href: '/dashboard/regions', label: 'Regions', icon: Map },
      { href: '/dashboard/builder', label: 'Builder', icon: Workflow },
    ],
  },
  {
    title: 'Network',
    items: [
      { href: '/dashboard/firewalls', label: 'Firewalls', icon: ShieldCheck },
      { href: '/dashboard/load-balancers', label: 'Load Balancers', icon: Network },
    ],
  },
  {
    title: 'Delivery',
    items: [
      { href: '/dashboard/deployments', label: 'Deployments', icon: Rocket },
      { href: '/dashboard/cicd', label: 'CI/CD', icon: GitBranch },
      { href: '/dashboard/runners', label: 'Runners', icon: Container },
      { href: '/dashboard/domains', label: 'Domains', icon: Globe },
    ],
  },
  {
    title: 'Observe',
    items: [{ href: '/dashboard/metrics', label: 'Metrics', icon: LineChart }],
  },
  {
    title: 'Workspace',
    items: [
      { href: '/dashboard/secrets', label: 'Secrets', icon: KeyRound },
      { href: '/dashboard/organization', label: 'Organization', icon: Building2 },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
      { href: '/dashboard/admin', label: 'Admin', icon: Shield, adminOnly: true },
    ],
  },
];

/** Flat list of every nav item (used by the command palette + search). */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
