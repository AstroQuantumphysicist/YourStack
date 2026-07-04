'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CreateRunnerPoolDialog({
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
  const [name, setName] = useState('');
  const [githubScope, setGithubScope] = useState('');
  const [labels, setLabels] = useState('self-hosted, linux, yourstack');
  const [minRunners, setMinRunners] = useState(0);
  const [maxRunners, setMaxRunners] = useState(3);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createRunnerPool(wid, {
        name: name.trim(),
        githubScope: githubScope.trim(),
        labels: labels
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean),
        minRunners,
        maxRunners,
      });
      toast.success('Runner pool created', name.trim());
      onCreated?.();
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create runner pool', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setGithubScope('');
    setLabels('self-hosted, linux, yourstack');
    setMinRunners(0);
    setMaxRunners(3);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create runner pool"
      description="Self-hosted GitHub Actions runners that execute jobs on your nodes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={name.trim().length < 2 || githubScope.trim().length < 2}
          >
            Create pool
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="rp-name">Name</Label>
          <Input
            id="rp-name"
            autoFocus
            placeholder="ci-runners"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp-scope">GitHub scope</Label>
          <Input
            id="rp-scope"
            placeholder="acme  or  acme/web"
            value={githubScope}
            onChange={(e) => setGithubScope(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            An org (<code>acme</code>) or a specific repo (<code>acme/web</code>).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp-labels">Labels</Label>
          <Input
            id="rp-labels"
            placeholder="self-hosted, linux"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. Target these in <code>runs-on:</code>.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rp-min">Min runners</Label>
            <Input
              id="rp-min"
              type="number"
              min={0}
              value={minRunners}
              onChange={(e) => setMinRunners(Math.max(0, Number(e.target.value)))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-max">Max runners</Label>
            <Input
              id="rp-max"
              type="number"
              min={1}
              value={maxRunners}
              onChange={(e) => setMaxRunners(Math.max(1, Number(e.target.value)))}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
