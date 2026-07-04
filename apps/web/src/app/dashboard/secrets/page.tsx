'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ProjectDTO, SecretDTO } from '@noderail/shared';
import { SecretScope } from '@noderail/shared';
import { useSession } from '@/lib/session';
import { useWorkspaceApps } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';

type Scope = 'app' | 'project';

export default function SecretsPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const toast = useToast();

  const appsData = useWorkspaceApps(wid);
  const projectsData = useSWR<{ projects: ProjectDTO[] }>(
    wid ? `/workspaces/${wid}/projects` : null,
  );

  const apps = appsData.data?.apps ?? [];
  const projects = projectsData.data?.projects ?? [];

  const [scope, setScope] = useState<Scope>('app');
  const [targetId, setTargetId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SecretDTO | null>(null);

  const targets = scope === 'app' ? apps : projects;

  // Default the target to the first available option when the scope changes.
  useEffect(() => {
    if (!targetId && targets.length > 0) setTargetId(targets[0]!.id);
  }, [targets, targetId]);
  useEffect(() => {
    setTargetId('');
  }, [scope]);

  const query = useMemo(() => {
    if (!targetId) return null;
    return scope === 'app' ? `/secrets?appId=${targetId}` : `/secrets?projectId=${targetId}`;
  }, [scope, targetId]);

  const secrets = useSWR<{ secrets: SecretDTO[] }>(query, () =>
    scope === 'app' ? api.secrets({ appId: targetId }) : api.secrets({ projectId: targetId }),
  );

  const list = secrets.data?.secrets ?? [];

  const remove = async (s: SecretDTO) => {
    if (!confirm(`Delete secret ${s.key}?`)) return;
    try {
      await api.deleteSecret(s.id);
      toast.success('Secret deleted', s.key);
      secrets.mutate();
    } catch (err) {
      toast.error('Could not delete secret', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Secrets"
        description="Encrypted environment variables, scoped to a project or app. Values are never shown again."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!targetId}>
            <Plus className="h-4 w-4" /> Add secret
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="w-40">
              <option value="app">App</option>
              <option value="project">Project</option>
            </Select>
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>{scope === 'app' ? 'App' : 'Project'}</Label>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Select {scope}…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {!targetId ? (
        <EmptyState
          icon={KeyRound}
          title={`Select ${scope === 'app' ? 'an app' : 'a project'}`}
          description="Choose a scope target above to view and manage its secrets."
        />
      ) : secrets.error ? (
        <ErrorState message="Could not load secrets." onRetry={() => secrets.mutate()} />
      ) : secrets.isLoading ? (
        <SkeletonRows rows={3} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No secrets in this scope"
          description="Add environment variables that apply to this scope."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Add secret
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Key</TH>
                <TH>Value</TH>
                <TH>Scope</TH>
                <TH>Updated</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((s) => (
                <TR key={s.id}>
                  <TD className="font-mono text-xs font-medium text-foreground">{s.key}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">••••{s.lastFour ?? ''}</TD>
                  <TD className="text-xs capitalize text-muted-foreground">{s.scope}</TD>
                  <TD className="text-xs text-muted-foreground">{timeAgo(s.updatedAt)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(s)}>
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <SecretDialog
        scope={scope}
        targetId={targetId}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => secrets.mutate()}
      />
      <SecretDialog
        scope={scope}
        targetId={targetId}
        secret={editing ?? undefined}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={() => secrets.mutate()}
      />
    </div>
  );
}

function SecretDialog({
  scope,
  targetId,
  secret,
  open,
  onClose,
  onSaved,
}: {
  scope: Scope;
  targetId: string;
  secret?: SecretDTO;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editMode = !!secret;
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editMode && secret) {
        await api.updateSecret(secret.id, value);
      } else {
        await api.createSecret({
          scope: scope === 'app' ? SecretScope.APP : SecretScope.PROJECT,
          key: key.trim(),
          value,
          ...(scope === 'app' ? { appId: targetId } : { projectId: targetId }),
        });
      }
      toast.success(editMode ? 'Secret updated' : 'Secret created');
      onSaved();
      setKey('');
      setValue('');
      onClose();
    } catch (err) {
      toast.error('Could not save secret', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editMode ? `Update ${secret?.key}` : 'Add secret'}
      description="Keys must be UPPERCASE_SNAKE_CASE."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={(!editMode && !key.trim()) || !value}>
            {editMode ? 'Update' : 'Create'}
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-3 py-2">
        {!editMode ? (
          <div className="space-y-1.5">
            <Label htmlFor="secret-key">Key</Label>
            <Input
              id="secret-key"
              autoFocus
              className="font-mono"
              placeholder="DATABASE_URL"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="secret-value">Value</Label>
          <Input
            id="secret-value"
            type="password"
            autoFocus={editMode}
            className="font-mono"
            placeholder="Enter value…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </form>
    </Dialog>
  );
}
