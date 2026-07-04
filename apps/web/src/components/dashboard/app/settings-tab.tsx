'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Trash2 } from 'lucide-react';
import type { AppDTO, NodeDTO } from '@yourstack/shared';
import { AppFramework, DeploymentStrategy } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SettingsTab({
  app,
  wid,
  onSaved,
}: {
  app: AppDTO;
  wid: string;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const nodes = useSWR<{ nodes: NodeDTO[] }>(`/workspaces/${wid}/nodes`);

  const [form, setForm] = useState({
    name: app.name,
    framework: app.framework ?? AppFramework.NODE,
    branch: app.branch,
    port: String(app.port),
    healthcheckPath: app.healthcheckPath,
    deploymentStrategy: app.deploymentStrategy,
    installCommand: app.installCommand ?? '',
    buildCommand: app.buildCommand ?? '',
    startCommand: app.startCommand ?? '',
    nodeId: app.nodeId ?? '',
    repoUrl: app.repoUrl ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateApp(app.id, {
        name: form.name.trim(),
        framework: form.framework,
        branch: form.branch.trim(),
        port: Number(form.port) || app.port,
        healthcheckPath: form.healthcheckPath.trim() || '/',
        deploymentStrategy: form.deploymentStrategy,
        installCommand: form.installCommand.trim() || undefined,
        buildCommand: form.buildCommand.trim() || undefined,
        startCommand: form.startCommand.trim() || undefined,
        nodeId: form.nodeId || undefined,
        repoUrl: form.repoUrl.trim() || undefined,
      });
      toast.success('Settings saved');
      onSaved?.();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete app "${app.name}"? This removes its container and cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteApp(app.id);
      toast.success('App deleted', app.name);
      router.push('/dashboard/apps');
    } catch (err) {
      toast.error('Could not delete app', err instanceof ApiError ? err.message : undefined);
      setDeleting(false);
    }
  };

  const nodeOptions = nodes.data?.nodes ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Assigned node">
            <Select value={form.nodeId} onChange={(e) => set('nodeId', e.target.value)}>
              <option value="">Unassigned</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Framework">
            <Select value={form.framework} onChange={(e) => set('framework', e.target.value as AppFramework)}>
              {Object.values(AppFramework).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deployment strategy">
            <Select
              value={form.deploymentStrategy}
              onChange={(e) => set('deploymentStrategy', e.target.value as DeploymentStrategy)}
            >
              {Object.values(DeploymentStrategy).map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Branch">
            <Input value={form.branch} onChange={(e) => set('branch', e.target.value)} />
          </Field>
          <Field label="Port">
            <Input type="number" value={form.port} onChange={(e) => set('port', e.target.value)} />
          </Field>
          <Field label="Healthcheck path">
            <Input
              value={form.healthcheckPath}
              onChange={(e) => set('healthcheckPath', e.target.value)}
            />
          </Field>
          <Field label="Repository URL">
            <Input value={form.repoUrl} onChange={(e) => set('repoUrl', e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build &amp; run commands</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Install command">
            <Input
              className="font-mono"
              placeholder="npm ci"
              value={form.installCommand}
              onChange={(e) => set('installCommand', e.target.value)}
            />
          </Field>
          <Field label="Build command">
            <Input
              className="font-mono"
              placeholder="npm run build"
              value={form.buildCommand}
              onChange={(e) => set('buildCommand', e.target.value)}
            />
          </Field>
          <Field label="Start command">
            <Input
              className="font-mono"
              placeholder="npm start"
              value={form.startCommand}
              onChange={(e) => set('startCommand', e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>

      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="text-danger">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Delete this app</p>
            <p className="text-xs text-muted-foreground">
              Removes the app and instructs its node to remove the container.
            </p>
          </div>
          <Button variant="danger" onClick={del} loading={deleting}>
            <Trash2 className="h-4 w-4" /> Delete app
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
