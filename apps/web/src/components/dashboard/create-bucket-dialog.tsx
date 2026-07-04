'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { ProjectDTO, RegionDTO } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMb } from '@/lib/format';

const NEW_PROJECT = '__new__';

export function CreateBucketDialog({
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
  const [region, setRegion] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [quotaMb, setQuotaMb] = useState(51200);
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const regionList: RegionDTO[] = regions.data?.regions ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);

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
      await api.createBucket(pid, {
        name: name.trim(),
        isPublic,
        quotaMb,
        region: region || undefined,
      });
      toast.success('Bucket provisioning', name.trim());
      onCreated?.();
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create bucket', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setProjectId('');
    setNewProjectName('');
    setRegion('');
    setIsPublic(false);
    setQuotaMb(51200);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create storage bucket"
      description="An S3-compatible object storage bucket backed by MinIO on your nodes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={name.trim().length < 2}>
            Create bucket
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="bk-name">Name</Label>
          <Input
            id="bk-name"
            autoFocus
            placeholder="assets"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          />
          <p className="text-xs text-muted-foreground">Lowercase letters, numbers and dashes.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bk-project">Project</Label>
            <Select id="bk-project" value={effectiveProject} onChange={(e) => setProjectId(e.target.value)}>
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
            <Label htmlFor="bk-region">Region</Label>
            <Select id="bk-region" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Auto (any node)</option>
              {regionList.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.flag ? `${r.flag} ` : ''}
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Quota</span>
            <span className="font-medium tabular-nums text-foreground">{formatMb(quotaMb)}</span>
          </div>
          <input
            type="range"
            min={1024}
            max={512000}
            step={1024}
            value={quotaMb}
            onChange={(e) => setQuotaMb(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted/40 p-3">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">Public bucket</span>
            <span className="block text-xs text-muted-foreground">
              Objects are readable over HTTP without credentials. Leave off for private storage.
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
