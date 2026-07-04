'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Gauge, Layers } from 'lucide-react';
import type { AppDTO, ScalingPolicyDTO } from '@yourstack/shared';
import { ScalingMetric } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartCard } from '@/components/metrics/chart-card';
import { RANGES } from '@/lib/metrics';

const METRICS = [
  { value: ScalingMetric.CPU, label: 'CPU utilization', unit: '%' },
  { value: ScalingMetric.MEMORY, label: 'Memory utilization', unit: '%' },
  { value: ScalingMetric.RPS, label: 'Requests / sec', unit: 'req/s' },
  { value: ScalingMetric.LATENCY, label: 'Latency', unit: 'ms' },
];

export function ScaleTab({ app }: { app: AppDTO }) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ policy: ScalingPolicyDTO | null }>(
    `/apps/${app.id}/scaling`,
  );
  const policy = data?.policy ?? null;

  const [form, setForm] = useState({
    enabled: false,
    minReplicas: 1,
    maxReplicas: 3,
    metric: ScalingMetric.CPU as string,
    targetValue: 70,
    cooldownSeconds: 300,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (policy) {
      setForm({
        enabled: policy.enabled,
        minReplicas: policy.minReplicas,
        maxReplicas: policy.maxReplicas,
        metric: policy.metric,
        targetValue: policy.targetValue,
        cooldownSeconds: policy.cooldownSeconds,
      });
    }
  }, [policy]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateScaling(app.id, form);
      toast.success('Autoscaling updated', form.enabled ? 'Policy is active' : 'Policy disabled');
      mutate();
    } catch (err) {
      toast.error('Could not update scaling', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const metricUnit = METRICS.find((m) => m.value === form.metric)?.unit ?? '';

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" /> Autoscaling
          </CardTitle>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-muted-foreground">{form.enabled ? 'Enabled' : 'Disabled'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => set('enabled', !form.enabled)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                form.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  form.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="min-replicas">Min replicas</Label>
                  <Input
                    id="min-replicas"
                    type="number"
                    min={0}
                    value={form.minReplicas}
                    onChange={(e) => set('minReplicas', Math.max(0, Number(e.target.value)))}
                    disabled={!form.enabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-replicas">Max replicas</Label>
                  <Input
                    id="max-replicas"
                    type="number"
                    min={1}
                    value={form.maxReplicas}
                    onChange={(e) => set('maxReplicas', Math.max(1, Number(e.target.value)))}
                    disabled={!form.enabled}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="scale-metric">Metric</Label>
                  <Select
                    id="scale-metric"
                    value={form.metric}
                    onChange={(e) => set('metric', e.target.value)}
                    disabled={!form.enabled}
                  >
                    {METRICS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scale-target">Target ({metricUnit})</Label>
                  <Input
                    id="scale-target"
                    type="number"
                    min={1}
                    value={form.targetValue}
                    onChange={(e) => set('targetValue', Number(e.target.value))}
                    disabled={!form.enabled}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="scale-cooldown">Cooldown (seconds)</Label>
                <Input
                  id="scale-cooldown"
                  type="number"
                  min={0}
                  step={30}
                  value={form.cooldownSeconds}
                  onChange={(e) => set('cooldownSeconds', Math.max(0, Number(e.target.value)))}
                  disabled={!form.enabled}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum time between scaling actions to avoid flapping.
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={save} loading={saving}>
                  Save policy
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Current
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Running replicas</p>
                <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
                  {policy?.currentReplicas ?? (isLoading ? '—' : form.minReplicas)}
                </p>
              </div>
              <Badge variant={form.enabled ? 'success' : 'default'}>
                {form.enabled ? 'Autoscaling' : 'Fixed'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Scaling between {form.minReplicas} and {form.maxReplicas} replicas to keep{' '}
              {METRICS.find((m) => m.value === form.metric)?.label.toLowerCase()} near{' '}
              {form.targetValue}
              {metricUnit}.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-3">
        <ChartCard
          title="Replicas over time"
          scope="app"
          targetId={app.id}
          kinds={['replicas']}
          range={RANGES[1]!}
          height={180}
        />
      </div>
    </div>
  );
}
