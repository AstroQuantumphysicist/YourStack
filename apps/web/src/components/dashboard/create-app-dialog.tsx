'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { NodeDTO, ProjectDTO } from '@yourstack/shared';
import { AppFramework } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FRAMEWORKS = [
  { value: AppFramework.NEXTJS, label: 'Next.js' },
  { value: AppFramework.NODE, label: 'Node' },
  { value: AppFramework.PYTHON, label: 'Python' },
  { value: AppFramework.DOCKERFILE, label: 'Dockerfile' },
  { value: AppFramework.STATIC, label: 'Static' },
];

const NEW_PROJECT = '__new__';

export function CreateAppDialog({
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
  const projects = useSWR<{ projects: ProjectDTO[] }>(
    open ? `/workspaces/${wid}/projects` : null,
  );
  const nodes = useSWR<{ nodes: NodeDTO[] }>(open ? `/workspaces/${wid}/nodes` : null);

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [newProjectName, setNewProjectName] = useState('');
  const [framework, setFramework] = useState<string>(AppFramework.NODE);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [port, setPort] = useState('3000');
  const [nodeId, setNodeId] = useState('');
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let pid = effectiveProject;
      if (pid === NEW_PROJECT) {
        const projName = newProjectName.trim() || name.trim();
        const { project } = await api.createProject(wid, { name: projName });
        pid = project.id;
      }
      await api.createApp(pid, {
        name: name.trim(),
        framework,
        repoUrl: repoUrl.trim() || undefined,
        branch: branch.trim() || 'main',
        port: Number(port) || 3000,
        nodeId: nodeId || undefined,
      });
      toast.success('App created', name.trim());
      onCreated?.();
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create app', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setProjectId('');
    setNewProjectName('');
    setFramework(AppFramework.NODE);
    setRepoUrl('');
    setBranch('main');
    setPort('3000');
    setNodeId('');
  };

  const nodeOptions = nodes.data?.nodes ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create app"
      description="Apps are deployed onto your nodes from a Git repository or Dockerfile."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={name.trim().length < 2}>
            Create app
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="app-name">Name</Label>
          <Input
            id="app-name"
            autoFocus
            placeholder="web-api"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-project">Project</Label>
          <Select
            id="app-project"
            value={effectiveProject}
            onChange={(e) => setProjectId(e.target.value)}
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
              placeholder="New project name (defaults to app name)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="app-framework">Framework</Label>
            <Select
              id="app-framework"
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
            >
              {FRAMEWORKS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-port">Port</Label>
            <Input
              id="app-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-repo">Repository URL (optional)</Label>
          <Input
            id="app-repo"
            placeholder="https://github.com/acme/web-api"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="app-branch">Branch</Label>
            <Input
              id="app-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-node">Node (optional)</Label>
            <Select id="app-node" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
              <option value="">Assign later</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.status})
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          An app needs an assigned online node before it can be deployed.
        </p>
      </form>
    </Dialog>
  );
}
