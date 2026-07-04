'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Sparkles, Wand2 } from 'lucide-react';
import type { ProjectDTO, RegionDTO, TemplateDTO } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const NEW_PROJECT = '__new__';

/** Map a deployed resource type to its detail route (best-effort). */
function resourceHref(resourceType: string, id: string): string | null {
  switch (resourceType) {
    case 'database':
      return `/dashboard/data/${id}`;
    case 'bucket':
    case 'storage':
      return `/dashboard/storage/${id}`;
    case 'function':
      return `/dashboard/functions/${id}`;
    case 'app':
      return `/dashboard/apps/${id}`;
    case 'cron':
    case 'cronjob':
      return `/dashboard/cron/${id}`;
    default:
      return null;
  }
}

export function DeployTemplateDialog({
  wid,
  template,
  open,
  onClose,
}: {
  wid: string;
  template: TemplateDTO | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const projects = useSWR<{ projects: ProjectDTO[] }>(
    open ? `/workspaces/${wid}/projects` : null,
  );
  const regions = useSWR(open ? ['regions'] : null, () => api.regions());

  const [projectId, setProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const projectList = projects.data?.projects ?? [];
  const regionList: RegionDTO[] = regions.data?.regions ?? [];
  const effectiveProject = projectId || (projectList[0]?.id ?? NEW_PROJECT);

  // Seed variable inputs from the template's declared defaults whenever the
  // selected template changes.
  useEffect(() => {
    if (!template) return;
    const seed: Record<string, string> = {};
    for (const v of template.variables) seed[v.key] = v.default ?? '';
    setValues(seed);
    setName('');
    setRegion('');
  }, [template]);

  const missingRequired = useMemo(() => {
    if (!template) return false;
    return template.variables.some((v) => v.required && !(values[v.key] ?? '').trim());
  }, [template, values]);

  if (!template) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let pid = effectiveProject;
      if (pid === NEW_PROJECT) {
        const { project } = await api.createProject(wid, {
          name: newProjectName.trim() || template.name,
        });
        pid = project.id;
      }

      // Only forward variables the user actually provided; empty auto-generated
      // fields are left to the platform to fill in.
      const variables: Record<string, string> = {};
      for (const v of template.variables) {
        const val = (values[v.key] ?? '').trim();
        if (val) variables[v.key] = val;
      }

      const result = await api.deployTemplate({
        templateSlug: template.slug,
        projectId: pid,
        name: name.trim() || undefined,
        region: region || undefined,
        variables,
      });

      toast.success('Deploying template', `${template.name} · provisioning now`);
      onClose();
      const href = resourceHref(result.resourceType, result.id);
      if (href) router.push(href);
    } catch (err) {
      toast.error('Could not deploy template', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Deploy ${template.name}`}
      description={template.description}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={missingRequired}>
            <Wand2 className="h-4 w-4" /> Deploy
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted/40 p-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-2xl">
            {template.icon ?? '📦'}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="primary" className="capitalize">
              {template.category}
            </Badge>
            {template.tags.slice(0, 5).map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Name (optional)</Label>
            <Input
              id="tpl-name"
              placeholder={template.slug}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-region">Region</Label>
            <Select id="tpl-region" value={region} onChange={(e) => setRegion(e.target.value)}>
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

        <div className="space-y-1.5">
          <Label htmlFor="tpl-project">Project</Label>
          <Select
            id="tpl-project"
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

        {template.variables.length > 0 ? (
          <div className="space-y-3 rounded-xl border border-border bg-surface-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Configuration
            </p>
            {template.variables.map((v) => {
              const autoGenerated = !v.required && !v.default;
              return (
                <div key={v.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`tpl-var-${v.key}`} className="text-xs">
                      {v.label}
                      {v.required ? <span className="ml-0.5 text-danger">*</span> : null}
                    </Label>
                    {v.secret ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        secret
                      </span>
                    ) : null}
                  </div>
                  <Input
                    id={`tpl-var-${v.key}`}
                    type={v.secret ? 'password' : 'text'}
                    autoComplete="off"
                    placeholder={autoGenerated ? 'auto-generated' : (v.default ?? v.key)}
                    value={values[v.key] ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
