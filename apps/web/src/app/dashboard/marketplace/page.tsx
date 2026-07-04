'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Search, Sparkles, Store, TrendingUp } from 'lucide-react';
import type { TemplateDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { DeployTemplateDialog } from '@/components/dashboard/deploy-template-dialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/utils';

const ALL = '__all__';

/** Debounce a fast-changing value (e.g. a search box) by `delay` ms. */
function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatPopularity(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export default function MarketplacePage() {
  const { workspace } = useSession();
  const wid = workspace?.id;

  const [category, setCategory] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [selected, setSelected] = useState<TemplateDTO | null>(null);

  // Full catalogue — powers the category chips so they don't disappear when a
  // filter is applied.
  const all = useSWR(['templates', 'all'], () => api.templates());

  // Filtered results driven by the active category + search (real query params).
  const list = useSWR(
    ['templates', category, debouncedSearch],
    () =>
      api.templates({
        category: category === ALL ? undefined : category,
        search: debouncedSearch || undefined,
      }),
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of all.data?.templates ?? []) set.add(t.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [all.data]);

  const templates = list.data?.templates ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <Store className="h-6 w-6 text-primary" /> Marketplace
          </span>
        }
        description="Deploy production-ready databases, tools and apps to your own infrastructure in one click."
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates — postgres, redis, ghost, umami…"
          className="h-11 pl-9"
          aria-label="Search templates"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip active={category === ALL} onClick={() => setCategory(ALL)}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </div>

      {list.error ? (
        <ErrorState message="Could not load the template catalogue." onRetry={() => list.mutate()} />
      ) : list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No templates found"
          description={
            debouncedSearch
              ? `Nothing matches “${debouncedSearch}”. Try a different search or category.`
              : 'No templates are available in this category yet.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((t) => (
            <button key={t.slug} type="button" onClick={() => setSelected(t)} className="text-left">
              <Card className="group flex h-full flex-col p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-2xl">
                    {t.icon ?? '📦'}
                  </span>
                  <Badge variant="default" className="gap-1">
                    <TrendingUp className="h-3 w-3" /> {formatPopularity(t.popularity)}
                  </Badge>
                </div>
                <p className="mt-3 font-semibold text-foreground">{t.name}</p>
                <p className="mt-1 line-clamp-2 flex-1 text-xs text-muted-foreground">
                  {t.description}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant="primary" className="capitalize">
                    {t.category}
                  </Badge>
                  {t.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {wid ? (
        <DeployTemplateDialog
          wid={wid}
          template={selected}
          open={selected !== null}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-xs font-medium capitalize transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-surface-muted text-muted-foreground hover:border-primary/30 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
