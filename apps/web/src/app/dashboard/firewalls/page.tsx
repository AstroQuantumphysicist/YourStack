'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { ArrowDownToLine, ArrowUpFromLine, Plus, Server, ShieldCheck } from 'lucide-react';
import type { FirewallDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { useAutoCreate } from '@/lib/hooks';
import { PageHeader } from '@/components/page-header';
import { CreateFirewallDialog } from '@/components/dashboard/create-firewall-dialog';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { pluralize } from '@/lib/format';

export default function FirewallsPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const { data, error, isLoading, mutate } = useSWR<{ firewalls: FirewallDTO[] }>(
    wid ? `/workspaces/${wid}/firewalls` : null,
  );
  const [createOpen, setCreateOpen] = useAutoCreate();

  const firewalls = data?.firewalls ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Firewalls"
        description="Cloud firewalls that control inbound and outbound traffic to your nodes."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New firewall
          </Button>
        }
      />

      {error ? (
        <ErrorState message="Could not load firewalls." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : firewalls.length === 0 ? (
        <EmptyIllustration
          icon={ShieldCheck}
          title="No firewalls yet"
          description="Create a firewall to lock down which ports and networks can reach your nodes. Start from a preset like Allow SSH/HTTP/HTTPS or deny all inbound."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create firewall
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {firewalls.map((fw) => {
            const inbound = fw.rules.filter((r) => r.direction === 'inbound').length;
            const outbound = fw.rules.filter((r) => r.direction === 'outbound').length;
            return (
              <Link key={fw.id} href={`/dashboard/firewalls/${fw.id}`}>
                <Card className="group h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
                        <ShieldCheck className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{fw.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {pluralize(fw.rules.length, 'rule')}
                        </p>
                      </div>
                    </div>
                    <StatusBadge kind="firewall" status={fw.status} />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="gap-1">
                      <ArrowDownToLine className="h-3 w-3" /> {inbound} in
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <ArrowUpFromLine className="h-3 w-3" /> {outbound} out
                    </Badge>
                    <Badge variant="default" className="gap-1">
                      <Server className="h-3 w-3" /> {pluralize(fw.nodeIds.length, 'node')}
                    </Badge>
                  </div>

                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      Inbound:{' '}
                      <span
                        className={
                          fw.defaultInbound === 'allow' ? 'text-warning' : 'text-success'
                        }
                      >
                        {fw.defaultInbound}
                      </span>
                    </span>
                    <span>
                      Outbound:{' '}
                      <span
                        className={
                          fw.defaultOutbound === 'deny' ? 'text-warning' : 'text-foreground'
                        }
                      >
                        {fw.defaultOutbound}
                      </span>
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {wid ? (
        <CreateFirewallDialog
          wid={wid}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => mutate()}
        />
      ) : null}
    </div>
  );
}
