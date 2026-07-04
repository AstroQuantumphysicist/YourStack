'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SecretDTO } from '@noderail/shared';
import { SecretScope } from '@noderail/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';

export function EnvTab({ appId }: { appId: string }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ secrets: SecretDTO[] }>(
    `/secrets?appId=${appId}`,
    () => api.secrets({ appId }),
  );
  const [editing, setEditing] = useState<SecretDTO | null>(null);
  const [creating, setCreating] = useState(false);

  const secrets = data?.secrets ?? [];

  const remove = async (s: SecretDTO) => {
    if (!confirm(`Delete secret ${s.key}? This cannot be undone.`)) return;
    try {
      await api.deleteSecret(s.id);
      toast.success('Secret deleted', s.key);
      mutate();
    } catch (err) {
      toast.error('Could not delete secret', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          App-scoped environment variables, encrypted at rest. Values are never shown after saving.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Add secret
        </Button>
      </div>

      {error ? (
        <ErrorState message="Could not load secrets." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} />
      ) : secrets.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No secrets"
          description="Add environment variables your app needs at build and runtime."
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
                <TH>Updated</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {secrets.map((s) => (
                <TR key={s.id}>
                  <TD className="font-mono text-xs font-medium text-foreground">{s.key}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">
                    ••••{s.lastFour ?? ''}
                  </TD>
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
        appId={appId}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => mutate()}
      />
      <SecretDialog
        appId={appId}
        secret={editing ?? undefined}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={() => mutate()}
      />
    </div>
  );
}

function SecretDialog({
  appId,
  secret,
  open,
  onClose,
  onSaved,
}: {
  appId: string;
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
        await api.createSecret({ scope: SecretScope.APP, appId, key: key.trim(), value });
      }
      toast.success(editMode ? 'Secret updated' : 'Secret created', editMode ? secret!.key : key.trim());
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
      description={
        editMode
          ? 'Enter a new value. The previous value cannot be recovered.'
          : 'Keys must be UPPERCASE_SNAKE_CASE (e.g. DATABASE_URL).'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            loading={saving}
            disabled={(!editMode && key.trim().length < 1) || value.length < 1}
          >
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
              placeholder="DATABASE_URL"
              className="font-mono"
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
            placeholder="Enter value…"
            className="font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </form>
    </Dialog>
  );
}
