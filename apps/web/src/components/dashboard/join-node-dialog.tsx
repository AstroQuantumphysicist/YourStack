'use client';

import { useState } from 'react';
import { Loader2, Terminal, TriangleAlert } from 'lucide-react';
import { api, ApiError, type JoinTokenResponse } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyButton } from '@/components/ui/copy-button';
import { formatDateFull } from '@/lib/format';

export function JoinNodeDialog({
  wid,
  open,
  onClose,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [region, setRegion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JoinTokenResponse | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.joinToken(wid, {
        label: label.trim() || undefined,
        region: region.trim() || undefined,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create a join token.');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setResult(null);
    setError(null);
    setLabel('');
    setRegion('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Join a node"
      description="Run one command on any server to attach it to this workspace."
      className="max-w-xl"
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={generate} loading={loading}>
              Generate install command
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4 py-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Run this on your server</Label>
              <CopyButton value={result.installCommand} label="Copy" />
            </div>
            <pre className="overflow-x-auto rounded-xl border border-border bg-[hsl(224_44%_3%)] p-3.5 text-xs">
              <code className="font-mono text-foreground">{result.installCommand}</code>
            </pre>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TokenField label="API URL" value={result.apiUrl} />
            <TokenField label="Join token" value={result.joinToken} mono />
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This token is shown only once and expires {formatDateFull(result.expiresAt)}. The agent
              registers over TLS and receives a long-lived credential after joining.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
            <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              The installer downloads the NodeRail agent, registers this machine with a one-time
              token, and starts sending heartbeats. Docker is required on the target host.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="node-label">Label (optional)</Label>
              <Input
                id="node-label"
                placeholder="prod-eu-1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="node-region">Region (optional)</Label>
              <Input
                id="node-region"
                placeholder="eu-central"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating token…
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function TokenField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <CopyButton value={value} />
      </div>
      <p className={`mt-1 truncate text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </p>
    </div>
  );
}
