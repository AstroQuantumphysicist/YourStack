'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Check } from 'lucide-react';
import type { FirewallDTO, NodeDTO } from '@yourstack/shared';
import { FirewallAction } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import { FIREWALL_PRESETS } from '@/lib/firewall-presets';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function CreateFirewallDialog({
  wid,
  open,
  onClose,
  onCreated,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
  onCreated?: (fw: FirewallDTO) => void;
}) {
  const toast = useToast();
  const nodes = useSWR<{ nodes: NodeDTO[] }>(open ? `/workspaces/${wid}/nodes` : null);

  const [name, setName] = useState('');
  const [presetKey, setPresetKey] = useState('web');
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const nodeList = nodes.data?.nodes ?? [];

  const toggleNode = (id: string) =>
    setNodeIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const preset = FIREWALL_PRESETS.find((p) => p.key === presetKey) ?? FIREWALL_PRESETS[0]!;
      const rules = preset.rules().map((r) => ({
        direction: r.direction,
        action: r.action,
        protocol: r.protocol,
        port: r.port || null,
        cidr: r.cidr,
        comment: r.comment || null,
      }));
      const { firewall } = await api.createFirewall(wid, {
        name: name.trim(),
        defaultInbound: FirewallAction.DENY,
        defaultOutbound: FirewallAction.ALLOW,
        nodeIds,
        rules,
      });
      toast.success('Firewall created', firewall.name);
      onCreated?.(firewall);
      reset();
      onClose();
    } catch (err) {
      toast.error('Could not create firewall', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setName('');
    setPresetKey('web');
    setNodeIds([]);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create firewall"
      description="Firewalls control which traffic can reach the nodes they're attached to."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={name.trim().length < 2}>
            Create firewall
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="fw-name">Name</Label>
          <Input
            id="fw-name"
            autoFocus
            placeholder="edge-web"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Start from a preset</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIREWALL_PRESETS.map((p) => {
              const active = p.key === presetKey;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPresetKey(p.key)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-surface-muted/40 hover:border-primary/30',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{p.label}</span>
                    {active ? <Check className="h-4 w-4 text-primary" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Attach to nodes</Label>
          {nodeList.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-muted/40 p-3 text-xs text-muted-foreground">
              No nodes in this workspace yet. You can attach nodes after creating the firewall.
            </p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {nodeList.map((n) => {
                const checked = nodeIds.includes(n.id);
                return (
                  <label
                    key={n.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                      checked ? 'border-primary/40 bg-primary/5' : 'border-border',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleNode(n.id)}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{n.name}</span>
                    <span className="text-xs text-muted-foreground">{n.publicIp ?? n.region ?? '—'}</span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Default inbound is <span className="font-medium text-foreground">deny</span>, default
            outbound <span className="font-medium text-foreground">allow</span>. Tune everything on
            the next screen.
          </p>
        </div>
      </form>
    </Dialog>
  );
}
