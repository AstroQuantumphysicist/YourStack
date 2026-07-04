'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Trash2 } from 'lucide-react';
import type { AppDTO, LoadBalancerDTO, ProjectDTO } from '@yourstack/shared';
import { LBAlgorithm } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const NEW_PROJECT = '__new__';

interface ManualTarget {
  address: string;
  weight: number;
}

export function CreateLoadBalancerDialog({
  wid,
  open,
  onClose,
  onCreated,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
  onCreated?: (lb: LoadBalancerDTO) => void;
}) {
  const toast = useToast();
  const projects = useSWR<{ projects: ProjectDTO[] }>(open ? `/workspaces/${wid}/projects` : null);

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [listenPort, setListenPort] = useState(80);
  const [algorithm, setAlgorithm] = useState<string>(LBAlgorithm.ROUND_ROBIN);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<ManualTarget[]>([]);
  const [domain, setDomain] = useState('');
  const [autoHttps, setAutoHttps] = useState(true);
  const [sticky, setSticky] = useState(false);
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);
  const apps = useSWR<{ apps: AppDTO[] }>(
    open && effectiveProject && effectiveProject !== NEW_PROJECT
      ? `/projects/${effectiveProject}/apps`
      : null,
  );
  const appList = apps.data?.apps ?? [];

  const toggleApp = (id: string) =>
    setAppIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

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
      const { loadBalancer } = await api.createLoadBalancer(pid, {
        name: name.trim(),
        listenPort,
        algorithm,
        appIds,
        targets: targets
          .filter((t) => t.address.trim())
          .map((t) => ({ address: t.address.trim(), weight: t.weight, appId: null })),
        domain: domain.trim() || undefined,
        autoHttps,
        sticky,
      });
      toast.success('Load balancer provisioning', loadBalancer.name);
      onCreated?.(loadBalancer);
      reset();
      onClose();
    } catch (err) {
      toast.error(
        'Could not create load balancer',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setProjectId('');
    setNewProjectName('');
    setListenPort(80);
    setAlgorithm(LBAlgorithm.ROUND_ROBIN);
    setAppIds([]);
    setTargets([]);
    setDomain('');
    setAutoHttps(true);
    setSticky(false);
  };

  const hasTargets = appIds.length > 0 || targets.some((t) => t.address.trim());

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create load balancer"
      description="Distribute traffic across app replicas or manual backend addresses."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={name.trim().length < 2 || !hasTargets}
          >
            Create load balancer
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lb-name">Name</Label>
            <Input
              id="lb-name"
              autoFocus
              placeholder="web-lb"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lb-port">Listen port</Label>
            <Input
              id="lb-port"
              type="number"
              min={1}
              max={65535}
              value={listenPort}
              onChange={(e) => setListenPort(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lb-project">Project</Label>
            <Select
              id="lb-project"
              value={effectiveProject}
              onChange={(e) => {
                setProjectId(e.target.value);
                setAppIds([]);
              }}
            >
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
            <Label htmlFor="lb-algo">Algorithm</Label>
            <Select id="lb-algo" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
              <option value={LBAlgorithm.ROUND_ROBIN}>Round robin</option>
              <option value={LBAlgorithm.LEAST_CONN}>Least connections</option>
              <option value={LBAlgorithm.IP_HASH}>IP hash</option>
            </Select>
          </div>
        </div>

        {effectiveProject !== NEW_PROJECT ? (
          <div className="space-y-1.5">
            <Label>Balance across apps</Label>
            {appList.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface-muted/40 p-3 text-xs text-muted-foreground">
                No apps in this project. Add manual targets below instead.
              </p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {appList.map((a) => {
                  const checked = appIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                        checked ? 'border-primary/40 bg-primary/5' : 'border-border',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleApp(a.id)}
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {a.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Manual targets</Label>
            <button
              type="button"
              onClick={() => setTargets((prev) => [...prev, { address: '', weight: 1 }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add target
            </button>
          </div>
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Optionally point at explicit host:port backends (e.g. 10.0.0.5:8080).
            </p>
          ) : (
            <div className="space-y-2">
              {targets.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="10.0.0.5:8080"
                    value={t.address}
                    onChange={(e) =>
                      setTargets((prev) =>
                        prev.map((x, xi) => (xi === i ? { ...x, address: e.target.value } : x)),
                      )
                    }
                    className="font-mono text-xs"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={t.weight}
                    onChange={(e) =>
                      setTargets((prev) =>
                        prev.map((x, xi) =>
                          xi === i ? { ...x, weight: Number(e.target.value) } : x,
                        ),
                      )
                    }
                    className="w-20"
                    aria-label="Weight"
                  />
                  <button
                    type="button"
                    onClick={() => setTargets((prev) => prev.filter((_, xi) => xi !== i))}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    aria-label="Remove target"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lb-domain">Domain (optional)</Label>
          <Input
            id="lb-domain"
            placeholder="app.example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-muted/40 p-3">
            <input
              type="checkbox"
              checked={autoHttps}
              onChange={(e) => setAutoHttps(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              disabled={!domain.trim()}
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Auto HTTPS</span>
              <span className="block text-xs text-muted-foreground">
                Provision a TLS certificate for the domain.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-muted/40 p-3">
            <input
              type="checkbox"
              checked={sticky}
              onChange={(e) => setSticky(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Sticky sessions</span>
              <span className="block text-xs text-muted-foreground">
                Pin a client to one backend.
              </span>
            </span>
          </label>
        </div>
      </form>
    </Dialog>
  );
}
