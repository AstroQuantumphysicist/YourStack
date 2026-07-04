'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { CalendarClock } from 'lucide-react';
import type { ProjectDTO, RegionDTO } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CRON_PRESETS, describeCron, isValidCronShape } from '@/lib/cron';
import { cn } from '@/lib/utils';

const NEW_PROJECT = '__new__';

export function CreateCronDialog({
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
  const [schedule, setSchedule] = useState('0 0 * * *');
  const [image, setImage] = useState('');
  const [command, setCommand] = useState('');
  const [cpu, setCpu] = useState(1);
  const [memoryMb, setMemoryMb] = useState(512);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const regionList: RegionDTO[] = regions.data?.regions ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);

  const readable = describeCron(schedule);
  const scheduleValid = isValidCronShape(schedule);

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
      await api.createCron(pid, {
        name: name.trim(),
        schedule: schedule.trim(),
        image: image.trim(),
        command: command.trim() || undefined,
        cpu,
        memoryMb,
        timeoutSeconds,
        region: region || undefined,
      });
      toast.success('Cron job scheduled', `${name.trim()} · ${readable ?? schedule.trim()}`);
      onCreated?.();
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create cron job', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setProjectId('');
    setNewProjectName('');
    setSchedule('0 0 * * *');
    setImage('');
    setCommand('');
    setCpu(1);
    setMemoryMb(512);
    setTimeoutSeconds(300);
    setRegion('');
  };

  const canSubmit = name.trim().length >= 2 && image.trim().length > 0 && scheduleValid;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create cron job"
      description="A container that runs on a schedule across your nodes."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!canSubmit}>
            Create cron job
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cron-name">Name</Label>
            <Input
              id="cron-name"
              autoFocus
              placeholder="nightly-backup"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cron-image">Image</Label>
            <Input
              id="cron-image"
              placeholder="ghcr.io/acme/job:latest"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="font-mono text-[13px]"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cron-schedule">Schedule</Label>
          <Input
            id="cron-schedule"
            placeholder="0 0 * * *"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="font-mono"
          />
          <div className="flex items-center gap-1.5 text-xs">
            <CalendarClock className="h-3.5 w-3.5 text-primary" />
            {!scheduleValid ? (
              <span className="text-warning">Enter 5 fields: minute hour day month weekday</span>
            ) : readable ? (
              <span className="text-muted-foreground">
                Runs <span className="font-medium text-foreground">{readable.toLowerCase()}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Custom schedule</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.expression}
                type="button"
                onClick={() => setSchedule(p.expression)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  schedule.trim() === p.expression
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-surface-muted text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cron-command">Command (optional)</Label>
          <Input
            id="cron-command"
            placeholder="node scripts/backup.js"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="font-mono text-[13px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cron-project">Project</Label>
            <Select
              id="cron-project"
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
                placeholder="New project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cron-region">Region</Label>
            <Select id="cron-region" value={region} onChange={(e) => setRegion(e.target.value)}>
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

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cron-cpu">vCPU</Label>
            <Select id="cron-cpu" value={cpu} onChange={(e) => setCpu(Number(e.target.value))}>
              {[1, 2, 4].map((c) => (
                <option key={c} value={c}>
                  {c} vCPU
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cron-mem">Memory</Label>
            <Select
              id="cron-mem"
              value={memoryMb}
              onChange={(e) => setMemoryMb(Number(e.target.value))}
            >
              {[256, 512, 1024, 2048].map((m) => (
                <option key={m} value={m}>
                  {m} MB
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cron-timeout">Timeout</Label>
            <Select
              id="cron-timeout"
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
            >
              {[60, 300, 900, 3600].map((t) => (
                <option key={t} value={t}>
                  {t >= 60 ? `${t / 60} min` : `${t}s`}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
