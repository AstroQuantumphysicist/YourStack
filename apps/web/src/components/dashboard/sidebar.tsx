'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/logo';
import { useSession } from '@/lib/session';
import { NAV_SECTIONS } from './nav';
import { WorkspaceSwitcher } from './workspace-switcher';
import { cn } from '@/lib/utils';

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useSession();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.adminOnly || user?.isPlatformAdmin),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="px-1 pt-1">
        <Link href="/dashboard" onClick={onNavigate}>
          <Wordmark size={26} />
        </Link>
      </div>

      <WorkspaceSwitcher />

      <nav className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
        {sections.map((section, i) => (
          <div key={section.title ?? `main-${i}`} className="space-y-1">
            {section.title ? (
              <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                  ) : null}
                  <Icon className={cn('h-[18px] w-[18px]', active && 'text-primary')} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="rounded-xl border border-border bg-surface-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Bring your own server.</p>
        <p className="mt-0.5">We turn it into a cloud.</p>
      </div>
    </div>
  );
}
