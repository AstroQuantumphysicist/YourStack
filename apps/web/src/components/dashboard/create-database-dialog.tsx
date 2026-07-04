'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { ProjectDTO, RegionDTO } from '@yourstack/shared';
import { DatabaseEngine } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EngineBadge } from './engine-badge';
import { formatMb } from '@/lib/format';
import { cn } from '@/lib/utils';

const ENGINES = [
  { value: DatabaseEngine.POSTGRES, label: 'PostgreSQL', versions: ['16', '15', '14'] },
  { value: DatabaseEngine.MYSQL, label: 'MySQL', versions: ['8.0', '5.7'] },
  { value: DatabaseEngine.REDIS, label: 'Redis', versions: ['7', '6'] },
  { value: DatabaseEngine.MONGODB, label: 'MongoDB', versions: ['7', '6'] },
];

const NEW_PROJECT = '__new__';

export function CreateDatabaseDialog({
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
  const [engine, setEngine] = useState<string>(DatabaseEngine.POSTGRES);
  const [version, setVersion] = useState('16');
  const [region, setRegion] = useState('');
  const [storageMb, setStorageMb] = useState(10240);
  const [cpu, setCpu] = useState(1);
  const [memoryMb, setMemoryMb] = useState(1024);
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const regionList: RegionDTO[] = regions.data?.regions ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);
  const engineDef = ENGINES.find((e) => e.value === engine)!;

  const pickEngine = (value: string) => {
    setEngine(value);
    const def = ENGINES.find((e) => e.value === value)!;
    setVersion(def.versions[0]!);
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
      await api.createDatabase(pid, {
        name: name.trim(),
        engine,
        version,
        storageMb,
        cpu,
        memoryMb,
        region: region || undefined,
      });
      toast.success('Database provisioning', `${engineDef.label} · ${name.trim()}`);
      onCreated?.();
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create database', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setProjectId('');
    setNewProjectName('');
    pickEngine(DatabaseEngine.POSTGRES);
    setRegion('');
    setStorageMb(10240);
    setCpu(1);
    setMemoryMb(1024);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create database"
      description="A managed database provisioned as a container on one of your nodes."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={name.trim().length < 2}>
            Create database
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>Engine</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ENGINES.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => pickEngine(e.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all',
                  engine === e.value
                    ? 'border-primary/60 bg-primary/5 shadow-glow'
                    : 'border-border hover:border-primary/30',
                )}
              >
                <EngineBadge engine={e.value} size={30} />
                <span className="text-xs font-medium text-foreground">{e.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="db-name">Name</Label>
            <Input
              id="db-name"
              autoFocus
              placeholder="primary-db"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="db-version">Version</Label>
            <Select id="db-version" value={version} onChange={(ev) => setVersion(ev.target.value)}>
              {engineDef.versions.map((v) => (
                <option key={v} value={v}>
                  {engineDef.label} {v}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="db-project">Project</Label>
            <Select
              id="db-project"
              value={effectiveProject}
              onChange={(ev) => setProjectId(ev.target.value)}
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
                onChange={(ev) => setNewProjectName(ev.target.value)}
              />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="db-region">Region</Label>
            <Select id="db-region" value={region} onChange={(ev) => setRegion(ev.target.value)}>
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

        <div className="space-y-3 rounded-xl border border-border bg-surface-muted/40 p-3">
          <SliderRow
            label="Storage"
            value={formatMb(storageMb)}
            min={1024}
            max={102400}
            step={1024}
            raw={storageMb}
            onChange={setStorageMb}
          />
          <SliderRow
            label="Memory"
            value={formatMb(memoryMb)}
            min={256}
            max={16384}
            step={256}
            raw={memoryMb}
            onChange={setMemoryMb}
          />
          <SliderRow
            label="vCPU"
            value={`${cpu} vCPU`}
            min={1}
            max={8}
            step={1}
            raw={cpu}
            onChange={setCpu}
          />
        </div>
      </form>
    </Dialog>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  raw,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  raw: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={raw}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
      />
    </div>
  );
}
