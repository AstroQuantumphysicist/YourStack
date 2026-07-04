'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Boxes,
  Clock,
  CornerDownLeft,
  Database,
  FunctionSquare,
  HardDrive,
  Plus,
  Search,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { NAV_ITEMS } from './dashboard/nav';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export const COMMAND_PALETTE_EVENT = 'yourstack:open-command-palette';

/** Programmatically open the ⌘K palette (used by the header search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(COMMAND_PALETTE_EVENT));
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: 'Actions' | 'Navigation';
  run: (router: ReturnType<typeof useRouter>) => void;
  keywords?: string;
}

/** Tiny subsequence fuzzy match with a light ranking score. */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

export function CommandPalette() {
  const router = useRouter();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      {
        id: 'new-app',
        label: 'Create app',
        icon: Boxes,
        group: 'Actions',
        keywords: 'new deploy service',
        run: (r) => r.push('/dashboard/apps?new=1'),
      },
      {
        id: 'new-database',
        label: 'Create database',
        icon: Database,
        group: 'Actions',
        keywords: 'new postgres mysql redis mongo data',
        run: (r) => r.push('/dashboard/data?new=1'),
      },
      {
        id: 'new-bucket',
        label: 'Create storage bucket',
        icon: HardDrive,
        group: 'Actions',
        keywords: 'new s3 object storage bucket',
        run: (r) => r.push('/dashboard/storage?new=1'),
      },
      {
        id: 'new-function',
        label: 'Create function',
        icon: FunctionSquare,
        group: 'Actions',
        keywords: 'new serverless lambda',
        run: (r) => r.push('/dashboard/functions?new=1'),
      },
      {
        id: 'browse-marketplace',
        label: 'Browse marketplace',
        icon: Store,
        group: 'Actions',
        keywords: 'template deploy app store catalog one-click',
        run: (r) => r.push('/dashboard/marketplace'),
      },
      {
        id: 'new-cron',
        label: 'Create cron job',
        icon: Clock,
        group: 'Actions',
        keywords: 'new scheduled task schedule job',
        run: (r) => r.push('/dashboard/cron?new=1'),
      },
    ];
    const nav: Command[] = NAV_ITEMS.filter((n) => !n.adminOnly || user?.isPlatformAdmin).map(
      (n) => ({
        id: `nav-${n.href}`,
        label: n.label,
        hint: n.href,
        icon: n.icon,
        group: 'Navigation' as const,
        run: (r: ReturnType<typeof useRouter>) => r.push(n.href),
      }),
    );
    return [...actions, ...nav];
  }, [user]);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, `${c.label} ${c.keywords ?? ''} ${c.hint ?? ''}`) }))
      .filter((x) => x.score >= 0);
    if (query) scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.c);
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  // Global ⌘K / Ctrl+K toggle + a custom event so buttons can open it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const runAt = useCallback(
    (i: number) => {
      const cmd = results[i];
      if (!cmd) return;
      close();
      cmd.run(router);
    },
    [results, router, close],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 animate-fade-in bg-background/70 backdrop-blur-sm" onClick={close} />
      <div className="glass relative z-10 w-full max-w-xl animate-scale-in overflow-hidden rounded-2xl border border-border shadow-card">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Command search"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matches for “{query}”.</p>
          ) : (
            results.map((cmd, i) => {
              const showHeader = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              const Icon = cmd.icon;
              const isActive = i === active;
              return (
                <div key={cmd.id}>
                  {showHeader ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {cmd.group}
                    </p>
                  ) : null}
                  <button
                    data-index={i}
                    onClick={() => runAt(i)}
                    onMouseMove={() => setActive(i)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border',
                        cmd.group === 'Actions' ? 'bg-primary/10 text-primary' : 'bg-surface-muted',
                      )}
                    >
                      {cmd.group === 'Actions' ? <Plus className="h-3.5 w-3.5" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="flex-1 truncate text-foreground">{cmd.label}</span>
                    {cmd.hint ? (
                      <span className="truncate text-xs text-muted-foreground">{cmd.hint}</span>
                    ) : null}
                    {isActive ? <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
