'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Boxes, Database, FunctionSquare, LineChart, Server } from 'lucide-react';
import type { NodeDTO } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import {
  useWorkspaceApps,
  useWorkspaceDatabases,
  useWorkspaceFunctions,
} from '@/lib/hooks';
import type { MetricScopeName } from '@/lib/api';
import { RANGES, type RangeOption } from '@/lib/metrics';
import { PageHeader } from '@/components/page-header';
import { ChartCard } from '@/components/metrics/chart-card';
import { RangeSelector, LiveDot } from '@/components/metrics/metrics-panel';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ScopeDef {
  scope: MetricScopeName;
  label: string;
  icon: typeof Boxes;
}

const SCOPES: ScopeDef[] = [
  { scope: 'app', label: 'Apps', icon: Boxes },
  { scope: 'node', label: 'Nodes', icon: Server },
  { scope: 'database', label: 'Databases', icon: Database },
  { scope: 'function', label: 'Functions', icon: FunctionSquare },
];

export default function MetricsPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;

  const apps = useWorkspaceApps(wid);
  const nodes = useSWR<{ nodes: NodeDTO[] }>(wid ? `/workspaces/${wid}/nodes` : null);
  const databases = useWorkspaceDatabases(wid);
  const functions = useWorkspaceFunctions(wid);

  const [scope, setScope] = useState<MetricScopeName>('app');
  const [targetId, setTargetId] = useState<string>('');
  const [range, setRange] = useState<RangeOption>(RANGES[1]!);

  const options = useMemo(() => {
    switch (scope) {
      case 'app':
        return (apps.data?.apps ?? []).map((a) => ({ id: a.id, label: `${a.projectName} / ${a.name}` }));
      case 'node':
        return (nodes.data?.nodes ?? []).map((n) => ({ id: n.id, label: n.name }));
      case 'database':
        return (databases.data?.items ?? []).map((d) => ({ id: d.id, label: `${d.projectName} / ${d.name}` }));
      case 'function':
        return (functions.data?.items ?? []).map((f) => ({ id: f.id, label: `${f.projectName} / ${f.name}` }));
    }
  }, [scope, apps.data, nodes.data, databases.data, functions.data]);

  // Default the selection to the first resource whenever the scope/list changes.
  useEffect(() => {
    if (options.length === 0) {
      setTargetId('');
    } else if (!options.some((o) => o.id === targetId)) {
      setTargetId(options[0]!.id);
    }
  }, [options, targetId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description="Inspect worker load — CPU, memory, requests, latency and replicas — across every resource in real time."
      />

      {/* Scope selector */}
      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => {
          const Icon = s.icon;
          const active = s.scope === scope;
          return (
            <button
              key={s.scope}
              onClick={() => setScope(s.scope)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" /> {s.label}
            </button>
          );
        })}
      </div>

      {/* Resource picker + range */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Resource</span>
          <Select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full sm:w-72"
            disabled={options.length === 0}
          >
            {options.length === 0 ? (
              <option value="">No resources</option>
            ) : (
              options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))
            )}
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <LiveDot live={!!targetId} />
          <RangeSelector value={range} onChange={setRange} />
        </div>
      </Card>

      {!targetId ? (
        <EmptyIllustration
          icon={LineChart}
          title="Nothing to chart yet"
          description="Create an app, node, database or function to start collecting time-series metrics here."
        />
      ) : (
        <MetricsGrid scope={scope} targetId={targetId} range={range} />
      )}
    </div>
  );
}

function MetricsGrid({
  scope,
  targetId,
  range,
}: {
  scope: MetricScopeName;
  targetId: string;
  range: RangeOption;
}) {
  if (scope === 'app') {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="CPU" scope={scope} targetId={targetId} kinds={['cpu_percent']} range={range} yMax={100} />
        <ChartCard title="Memory" scope={scope} targetId={targetId} kinds={['mem_mb']} range={range} />
        <ChartCard title="Requests / sec" scope={scope} targetId={targetId} kinds={['rps']} range={range} />
        <ChartCard title="Latency" scope={scope} targetId={targetId} kinds={['latency_ms']} range={range} />
        <ChartCard title="Replicas" scope={scope} targetId={targetId} kinds={['replicas']} range={range} />
      </div>
    );
  }
  if (scope === 'node') {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="CPU" scope={scope} targetId={targetId} kinds={['cpu_percent']} range={range} yMax={100} />
        <ChartCard title="Memory" scope={scope} targetId={targetId} kinds={['mem_mb']} range={range} />
        <ChartCard title="Network (in / out)" scope={scope} targetId={targetId} kinds={['net_rx_kb', 'net_tx_kb']} range={range} />
        <ChartCard title="Disk" scope={scope} targetId={targetId} kinds={['disk_mb']} range={range} />
      </div>
    );
  }
  if (scope === 'database') {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="CPU" scope={scope} targetId={targetId} kinds={['cpu_percent']} range={range} yMax={100} />
        <ChartCard title="Memory" scope={scope} targetId={targetId} kinds={['mem_mb']} range={range} />
      </div>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Requests / sec" scope={scope} targetId={targetId} kinds={['rps']} range={range} />
      <ChartCard title="Latency" scope={scope} targetId={targetId} kinds={['latency_ms']} range={range} />
    </div>
  );
}
