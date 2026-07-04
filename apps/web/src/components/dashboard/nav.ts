import {
  Boxes,
  GitBranch,
  Globe,
  KeyRound,
  LayoutDashboard,
  Rocket,
  Server,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only show for platform admins. */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/apps', label: 'Apps', icon: Boxes },
  { href: '/dashboard/nodes', label: 'Nodes', icon: Server },
  { href: '/dashboard/deployments', label: 'Deployments', icon: Rocket },
  { href: '/dashboard/cicd', label: 'CI/CD', icon: GitBranch },
  { href: '/dashboard/secrets', label: 'Secrets', icon: KeyRound },
  { href: '/dashboard/domains', label: 'Domains', icon: Globe },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/admin', label: 'Admin', icon: Shield, adminOnly: true },
];
