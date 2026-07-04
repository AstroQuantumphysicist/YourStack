'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DomainDTO } from '@noderail/shared';
import { api, ApiError, type DnsInstructions } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { CopyButton } from '@/components/ui/copy-button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { timeAgo } from '@/lib/format';

export function DomainsTab({ appId }: { appId: string }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ domains: DomainDTO[] }>(
    `/apps/${appId}/domains`,
  );
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [saving, setSaving] = useState(false);
  const [instructions, setInstructions] = useState<DnsInstructions | null>(null);

  const domains = data?.domains ?? [];

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.createDomain(appId, hostname.trim().toLowerCase());
      setInstructions(res.instructions);
      toast.success('Domain added', 'Follow the DNS instructions to verify.');
      setHostname('');
      mutate();
    } catch (err) {
      toast.error('Could not add domain', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const verify = async (d: DomainDTO) => {
    try {
      await api.verifyDomain(d.id);
      toast.info('Verification started', d.hostname);
      mutate();
    } catch (err) {
      toast.error('Verification failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const remove = async (d: DomainDTO) => {
    if (!confirm(`Remove ${d.hostname}?`)) return;
    try {
      await api.deleteDomain(d.id);
      toast.success('Domain removed', d.hostname);
      mutate();
    } catch (err) {
      toast.error('Could not remove domain', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Bring your own domain. DNS is verified automatically and HTTPS is provisioned at the edge.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setInstructions(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add domain
        </Button>
      </div>

      {error ? (
        <ErrorState message="Could not load domains." onRetry={() => mutate()} />
      ) : isLoading ? (
        <SkeletonRows rows={2} />
      ) : domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No custom domains"
          description="Add a hostname to route public traffic to this app."
        />
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    <span className="truncate font-medium text-foreground">{d.hostname}</span>
                    <StatusBadge kind="domain" status={d.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Target <code className="text-foreground">{d.dnsTarget}</code> · checked{' '}
                    {timeAgo(d.lastCheckedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => verify(d)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Verify
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(d)}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add custom domain"
        description="Enter a hostname you control. We'll give you a DNS record to add."
        footer={
          instructions ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={add} loading={saving} disabled={hostname.trim().length < 3}>
                Add domain
              </Button>
            </>
          )
        }
      >
        {instructions ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Create this DNS record with your provider. Verification runs automatically once it
              resolves.
            </p>
            <div className="rounded-xl border border-border bg-surface-muted p-3 text-sm">
              <DnsRow label="Type" value={instructions.recordType} />
              <DnsRow label="Name" value={instructions.name} />
              <DnsRow label="Value" value={instructions.value} copy />
            </div>
            <p className="text-xs text-muted-foreground">{instructions.note}</p>
          </div>
        ) : (
          <form onSubmit={add} className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="domain-host">Hostname</Label>
              <Input
                id="domain-host"
                autoFocus
                placeholder="app.example.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value.toLowerCase())}
              />
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function DnsRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <code className="truncate font-mono text-xs text-foreground">{value}</code>
        {copy ? <CopyButton value={value} /> : null}
      </span>
    </div>
  );
}
