'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, GitCommitHorizontal, Rocket } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useWorkspaceDeployments } from '@/lib/hooks';
import { PageHeader } from '@/components/page-header';
import { DeploymentDetail } from '@/components/dashboard/deployment-detail';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo, shortId } from '@/lib/format';

function DeploymentsInner() {
  const params = useSearchParams();
  const initial = params.get('id');
  const { workspace } = useSession();
  const { data, error, isLoading, mutate } = useWorkspaceDeployments(workspace?.id);
  const [selected, setSelected] = useState<string | null>(initial);

  const deployments = data?.deployments ?? [];

  if (selected) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All deployments
        </button>
        <DeploymentDetail deploymentId={selected} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Every pipeline run across your workspace, newest first."
      />

      {error ? (
        <ErrorState message="Could not load deployments." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={6} />
      ) : deployments.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No deployments yet"
          description="Deploy an app to see its pipeline runs, logs, and history here."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>App</TH>
                <TH>Version</TH>
                <TH>Status</TH>
                <TH>Commit</TH>
                <TH>Triggered by</TH>
                <TH>When</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {deployments.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium text-foreground">{d.appName}</TD>
                  <TD className="text-muted-foreground">v{d.version}</TD>
                  <TD>
                    <StatusBadge kind="deployment" status={d.status} />
                  </TD>
                  <TD>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <GitCommitHorizontal className="h-3.5 w-3.5" />
                      {d.commitSha ? shortId(d.commitSha) : d.ref ?? '—'}
                    </span>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{d.triggeredBy ?? '—'}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">
                    {timeAgo(d.createdAt)}
                  </TD>
                  <TD className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setSelected(d.id)}>
                      View
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export default function DeploymentsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <DeploymentsInner />
    </Suspense>
  );
}
