'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Globe, RefreshCw } from 'lucide-react';
import type { DomainDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { CopyButton } from '@/components/ui/copy-button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';

interface DomainWithApp extends DomainDTO {
  appName: string;
}

export default function DomainsPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR(
    wid ? ['ws-domains', wid] : null,
    async (): Promise<{ domains: DomainWithApp[] }> => {
      const { projects } = await api.projects(wid!);
      const appLists = await Promise.all(projects.map((p) => api.projectApps(p.id)));
      const apps = appLists.flatMap((l) => l.apps);
      const domainLists = await Promise.all(
        apps.map(async (a) => {
          const { domains } = await api.appDomains(a.id);
          return domains.map<DomainWithApp>((d) => ({ ...d, appName: a.name }));
        }),
      );
      return { domains: domainLists.flat() };
    },
  );

  const domains = data?.domains ?? [];

  const verify = async (d: DomainWithApp) => {
    try {
      await api.verifyDomain(d.id);
      toast.info('Verification started', d.hostname);
      mutate();
    } catch (err) {
      toast.error('Verification failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains"
        description="Custom domains across your apps, with verification status and DNS targets."
      />

      {error ? (
        <ErrorState message="Could not load domains." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No custom domains"
          description="Add a domain from an app's Domains tab to route public traffic to it."
        />
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    <span className="truncate font-medium text-foreground">{d.hostname}</span>
                    <StatusBadge kind="domain" status={d.status} />
                    <Link
                      href={`/dashboard/apps/${d.appId}`}
                      className="text-xs text-muted-foreground hover:text-primary"
                    >
                      {d.appName}
                    </Link>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      DNS → <code className="text-foreground">{d.dnsTarget}</code>
                    </span>
                    <CopyButton value={d.dnsTarget} />
                    <span>· checked {timeAgo(d.lastCheckedAt)}</span>
                  </div>
                  {d.status !== 'active' && d.status !== 'verified' ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Add a{' '}
                      <code className="text-foreground">
                        {/^\d+\.\d+\.\d+\.\d+$/.test(d.dnsTarget) ? 'A' : 'CNAME'}
                      </code>{' '}
                      record for <code className="text-foreground">{d.hostname}</code> pointing to{' '}
                      <code className="text-foreground">{d.dnsTarget}</code>.
                    </p>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" onClick={() => verify(d)}>
                  <RefreshCw className="h-3.5 w-3.5" /> Verify
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
