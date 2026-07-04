'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { ProjectDTO, RegionDTO } from '@yourstack/shared';
import { FunctionRuntime } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RuntimeBadge } from './engine-badge';
import { cn } from '@/lib/utils';

const RUNTIMES = [
  { value: FunctionRuntime.NODE20, label: 'Node 20', handler: 'index.handler' },
  { value: FunctionRuntime.PYTHON311, label: 'Python 3.11', handler: 'main.handler' },
  { value: FunctionRuntime.GO122, label: 'Go 1.22', handler: 'main.Handler' },
  { value: FunctionRuntime.BUN1, label: 'Bun 1', handler: 'index.handler' },
];

const STARTER_CODE: Record<string, string> = {
  node20: `export async function handler(event) {\n  return { message: "Hello from YourStack", event };\n}\n`,
  bun1: `export async function handler(event) {\n  return { message: "Hello from YourStack", event };\n}\n`,
  python311: `def handler(event):\n    return {"message": "Hello from YourStack", "event": event}\n`,
  go122: `package main\n\nfunc Handler(event map[string]any) (any, error) {\n\treturn map[string]any{"message": "Hello from YourStack"}, nil\n}\n`,
};

const NEW_PROJECT = '__new__';

export function CreateFunctionDialog({
  wid,
  open,
  onClose,
  onCreated,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const toast = useToast();
  const projects = useSWR<{ projects: ProjectDTO[] }>(open ? `/workspaces/${wid}/projects` : null);
  const regions = useSWR(open ? ['regions'] : null, () => api.regions());

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [runtime, setRuntime] = useState<string>(FunctionRuntime.NODE20);
  const [handler, setHandler] = useState('index.handler');
  const [memoryMb, setMemoryMb] = useState(256);
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [minInstances, setMinInstances] = useState(0);
  const [source, setSource] = useState<'code' | 'repo'>('code');
  const [code, setCode] = useState(STARTER_CODE.node20!);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const regionList: RegionDTO[] = regions.data?.regions ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);

  const pickRuntime = (value: string) => {
    setRuntime(value);
    const def = RUNTIMES.find((r) => r.value === value)!;
    setHandler(def.handler);
    setCode(STARTER_CODE[value] ?? '');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let pid = effectiveProject;
      if (pid === NEW_PROJECT) {
        const { project } = await api.createProject(wid, {
          name: newProjectName.trim() || name.trim(),
        });
        pid = project.id;
      }
      await api.createFunction(pid, {
        name: name.trim(),
        runtime,
        handler: handler.trim(),
        memoryMb,
        timeoutMs,
        minInstances,
        region: region || undefined,
        ...(source === 'repo'
          ? { repoUrl: repoUrl.trim() || undefined, branch: branch.trim() || 'main' }
          : { code }),
      });
      toast.success('Function deploying', name.trim());
      onCreated?.();
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create function', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setProjectId('');
    setNewProjectName('');
    pickRuntime(FunctionRuntime.NODE20);
    setMemoryMb(256);
    setTimeoutMs(10000);
    setMinInstances(0);
    setSource('code');
    setRepoUrl('');
    setBranch('main');
    setRegion('');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create function"
      description="A serverless function deployed to your nodes and invoked over HTTP."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={name.trim().length < 2}>
            Create function
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>Runtime</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RUNTIMES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => pickRuntime(r.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all',
                  runtime === r.value
                    ? 'border-primary/60 bg-primary/5 shadow-glow'
                    : 'border-border hover:border-primary/30',
                )}
              >
                <RuntimeBadge runtime={r.value} size={30} />
                <span className="text-xs font-medium text-foreground">{r.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="fn-name">Name</Label>
            <Input
              id="fn-name"
              autoFocus
              placeholder="resize-image"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fn-handler">Handler</Label>
            <Input id="fn-handler" value={handler} onChange={(e) => setHandler(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="fn-mem">Memory (MB)</Label>
            <Select id="fn-mem" value={memoryMb} onChange={(e) => setMemoryMb(Number(e.target.value))}>
              {[128, 256, 512, 1024, 2048].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fn-timeout">Timeout (ms)</Label>
            <Select
              id="fn-timeout"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
            >
              {[3000, 10000, 30000, 60000].map((t) => (
                <option key={t} value={t}>
                  {t / 1000}s
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fn-min">Min instances</Label>
            <Select
              id="fn-min"
              value={minInstances}
              onChange={(e) => setMinInstances(Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fn-region">Region</Label>
            <Select id="fn-region" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Auto</option>
              {regionList.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.flag ? `${r.flag} ` : ''}
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fn-project">Project</Label>
          <Select id="fn-project" value={effectiveProject} onChange={(e) => setProjectId(e.target.value)}>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={NEW_PROJECT}>+ New project…</option>
          </Select>
          {effectiveProject === NEW_PROJECT ? (
            <Input
              className="mt-2"
              placeholder="New project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
          ) : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Source</Label>
            <div className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSource('code')}
                className={cn('rounded-md px-2.5 py-1 font-medium', source === 'code' ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
              >
                Inline code
              </button>
              <button
                type="button"
                onClick={() => setSource('repo')}
                className={cn('rounded-md px-2.5 py-1 font-medium', source === 'repo' ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
              >
                From repo
              </button>
            </div>
          </div>
          {source === 'code' ? (
            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={7}
              className="font-mono text-[13px]"
              spellCheck={false}
            />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Input
                className="col-span-2"
                placeholder="https://github.com/acme/functions"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <Input placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
          )}
        </div>
      </form>
    </Dialog>
  );
}
