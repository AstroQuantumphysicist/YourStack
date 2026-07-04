'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
  Play,
  RotateCw,
  Rocket,
  Settings,
  Square,
} from 'lucide-react';
import type { AppDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { OverviewTab } from '@/components/dashboard/app/overview-tab';
import { DeploymentsTab } from '@/components/dashboard/app/deployments-tab';
import { LogsTab } from '@/components/dashboard/app/logs-tab';
import { EnvTab } from '@/components/dashboard/app/env-tab';
import { DomainsTab } from '@/components/dashboard/app/domains-tab';
import { SettingsTab } from '@/components/dashboard/app/settings-tab';

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'deployments', label: 'Deployments', icon: Rocket },
  { value: 'logs', label: 'Logs', icon: FileText },
  { value: 'env', label: 'Env vars', icon: KeyRound },
  { value: 'domains', label: 'Domains', icon: Globe },
  { value: 'settings', label: 'Settings', icon: Settings },
];

export default function AppDetailPage() {
  const params = useParams<{ id: string }>();
  const appId = params.id;
  const { workspace } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<{ app: AppDTO }>(`/apps/${appId}`);
  const app = data?.app;

  // Live status: refresh the app on any deployment/status event.
  useSSE(`app:${appId}`, {
    onEvent: (msg) => {
      if (msg.type === 'deployment.status' || msg.type === 'deployment.created') {
        mutate();
      }
    },
  });

  const runAction = useCallback(
    async (action: 'deploy' | 'stop' | 'restart') => {
      setBusy(action);
      try {
        if (action === 'deploy') {
          const r = await api.deployApp(appId, { reason: 'manual deploy from dashboard' });
          toast.success('Deployment started', `Version v${r.version} queued`);
        } else if (action === 'stop') {
          await api.stopApp(appId);
          toast.success('Stop requested');
        } else {
          await api.restartApp(appId);
          toast.success('Restart requested');
        }
        mutate();
      } catch (err) {
        toast.error(
          `Could not ${action} app`,
          err instanceof ApiError ? err.message : undefined,
        );
      } finally {
        setBusy(null);
      }
    },
    [appId, toast, mutate],
  );

  if (error && !app) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load app.'}
          onRetry={() => mutate()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isLoading || !app ? <Skeleton className="h-7 w-40" /> : app.name}
            {app ? <StatusBadge kind="app" status={app.status} /> : null}
          </span>
        }
        description={app ? `Port :${app.port} · ${app.framework ?? 'custom'} · ${app.branch}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              loading={busy === 'deploy'}
              disabled={!app?.nodeId || !!busy}
              onClick={() => runAction('deploy')}
            >
              <Play className="h-4 w-4" /> Deploy
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'restart'}
              disabled={!app?.nodeId || !!busy}
              onClick={() => runAction('restart')}
            >
              <RotateCw className="h-4 w-4" /> Restart
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'stop'}
              disabled={!app?.nodeId || !!busy}
              onClick={() => runAction('stop')}
            >
              <Square className="h-4 w-4" /> Stop
            </Button>
          </div>
        }
      />

      {!app?.nodeId && app ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
          This app has no node assigned. Assign an online node in Settings before deploying.
        </div>
      ) : null}

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div className="animate-fade-in">
        {isLoading || !app ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : tab === 'overview' ? (
          <OverviewTab app={app} />
        ) : tab === 'deployments' ? (
          <DeploymentsTab app={app} onChange={() => mutate()} />
        ) : tab === 'logs' ? (
          <LogsTab appId={app.id} />
        ) : tab === 'env' ? (
          <EnvTab appId={app.id} />
        ) : tab === 'domains' ? (
          <DomainsTab appId={app.id} />
        ) : workspace ? (
          <SettingsTab app={app} wid={workspace.id} onSaved={() => mutate()} />
        ) : null}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/apps"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All apps
    </Link>
  );
}
