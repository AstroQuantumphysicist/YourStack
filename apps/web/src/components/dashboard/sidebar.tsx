'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/logo';
import { useSession } from '@/lib/session';
import { NAV_ITEMS } from './nav';
import { WorkspaceSwitcher } from './workspace-switcher';
import { cn } from '@/lib/utils';

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useSession();

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="px-1 pt-1">
        <Link href="/dashboard" onClick={onNavigate}>
          <Wordmark size={26} />
        </Link>
      </div>

      <WorkspaceSwitcher />

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.filter((item) => !item.adminOnly || user?.isPlatformAdmin).map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
              )}
            >
              <Icon className={cn('h-4.5 w-4.5 h-[18px] w-[18px]', active && 'text-primary')} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-xl border border-border bg-surface-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Bring your own server.</p>
        <p className="mt-0.5">We turn it into a cloud.</p>
      </div>
    </div>
  );
}
