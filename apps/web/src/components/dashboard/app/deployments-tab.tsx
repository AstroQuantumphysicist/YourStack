'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { GitCommitHorizontal, RotateCcw, Rocket } from 'lucide-react';
import type { AppDTO, DeploymentDTO } from '@yourstack/shared';
import { DeploymentStatus } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo, shortId } from '@/lib/format';

export function DeploymentsTab({ app, onChange }: { app: AppDTO; onChange?: () => void }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ deployments: DeploymentDTO[] }>(
    `/apps/${app.id}/deployments`,
  );
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const deployments = data?.deployments ?? [];

  const rollback = async (d: DeploymentDTO) => {
    setRollingBack(d.id);
    try {
      await api.rollbackApp(app.id, d.id);
      toast.success('Rollback started', `Rolling back to v${d.version}`);
      onChange?.();
      mutate();
    } catch (err) {
      toast.error('Rollback failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setRollingBack(null);
    }
  };

  if (error) return <ErrorState message="Could not load deployments." onRetry={() => mutate()} />;
  if (isLoading) return <SkeletonRows rows={5} />;
  if (deployments.length === 0) {
    return (
      <EmptyState
        icon={Rocket}
        title="No deployments yet"
        description="Trigger a deploy to build and ship this app to its node."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>Version</TH>
            <TH>Status</TH>
            <TH>Commit</TH>
            <TH>Trigger</TH>
            <TH>When</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {deployments.map((d) => {
            const isCurrent = app.currentDeploymentId === d.id;
            const canRollback =
              !isCurrent &&
              (d.status === DeploymentStatus.RUNNING ||
                d.status === DeploymentStatus.SUPERSEDED ||
                d.status === DeploymentStatus.ROLLED_BACK);
            return (
              <TR key={d.id}>
                <TD>
                  <Link
                    href={`/dashboard/deployments?id=${d.id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    v{d.version}
                  </Link>
                  {isCurrent ? (
                    <span className="ml-2 text-xs text-success">current</span>
                  ) : null}
                </TD>
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
                  {canRollback ? (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={rollingBack === d.id}
                      onClick={() => rollback(d)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Rollback
                    </Button>
                  ) : null}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}
