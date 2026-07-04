'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Cpu,
  History,
  Power,
  RefreshCw,
  Terminal,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { NodeDTO } from '@yourstack/shared';
import { api, ApiError, type NodeActionKind, type NodeCommand } from '@/lib/api';
import { useSSE } from '@/lib/use-sse';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { formatMb, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

type ActionState = { action: NodeActionKind; version: string } | null;

const cmdVariant: Record<string, NonNullable<BadgeProps['variant']>> = {
  succeeded: 'success',
  running: 'info',
  accepted: 'info',
  queued: 'default',
  failed: 'danger',
  timed_out: 'warning',
};

export function NodeManageTab({ node }: { node: NodeDTO }) {
  const toast = useToast();
  const commands = useSWR<{ commands: NodeCommand[] }>(`/nodes/${node.id}/commands`);
  const [pending, setPending] = useState<ActionState>(null);
  const [busy, setBusy] = useState(false);

  useSSE(`node:${node.id}`, {
    onEvent: (msg) => {
      if (msg.type === 'command.update') commands.mutate();
    },
  });

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.nodeAction(
        node.id,
        pending.action,
        pending.action === 'agent_update' ? pending.version.trim() || undefined : undefined,
      );
      toast.success('Command queued', ACTIONS[pending.action].verb);
      setPending(null);
      commands.mutate();
    } catch (err) {
      toast.error('Could not run command', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const list = commands.data?.commands ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> System info
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Info label="Hostname" value={node.name} />
              <Info label="Public IP" value={node.publicIp ?? '—'} mono />
              <Info label="OS / Arch" value={`${node.os ?? '—'} / ${node.arch ?? '—'}`} />
              <Info label="Region" value={node.region ?? '—'} />
              <Info label="Agent" value={node.agentVersion ?? '—'} mono />
              <Info label="Docker" value={node.dockerVersion ?? '—'} mono />
              <Info label="CPU cores" value={node.cpuCores != null ? String(node.cpuCores) : '—'} />
              <Info label="Memory" value={formatMb(node.memoryTotalMb)} />
              <Info label="Disk" value={formatMb(node.diskTotalMb)} />
              <Info label="Heartbeat" value={timeAgo(node.lastHeartbeatAt)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" /> Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <ActionButton
              icon={Power}
              title="Reboot node"
              description="Gracefully restart the machine. Running containers restart on boot."
              onClick={() => setPending({ action: 'reboot', version: '' })}
            />
            <ActionButton
              icon={Trash2}
              title="Prune Docker"
              description="Remove dangling images, stopped containers and unused build cache."
              onClick={() => setPending({ action: 'docker_prune', version: '' })}
            />
            <ActionButton
              icon={UploadCloud}
              title="Update agent"
              description="Pull and install a new YourStack agent version on this node."
              onClick={() => setPending({ action: 'agent_update', version: '' })}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Command history
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => commands.mutate()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {commands.isLoading ? (
            <SkeletonRows rows={4} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Terminal}
              title="No commands yet"
              description="Actions you run on this node will appear here with their status and output."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Command</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                  <TH>Output</TH>
                </TR>
              </THead>
              <TBody>
                {list.map((c) => (
                  <TR key={c.id} className="align-top">
                    <TD className="font-mono text-xs text-foreground">{c.type}</TD>
                    <TD>
                      <Badge variant={cmdVariant[c.status] ?? 'default'} className="capitalize">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full bg-current',
                            (c.status === 'running' || c.status === 'accepted') && 'animate-pulse-dot',
                          )}
                        />
                        {c.status.replace(/_/g, ' ')}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground">
                      {timeAgo(c.createdAt)}
                    </TD>
                    <TD className="max-w-xs">
                      <CommandOutput command={c} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? ACTIONS[pending.action].title : ''}
        description={pending ? ACTIONS[pending.action].confirm : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending?.action === 'reboot' ? 'danger' : 'primary'}
              loading={busy}
              onClick={run}
            >
              {pending ? ACTIONS[pending.action].verb : 'Run'}
            </Button>
          </>
        }
      >
        {pending?.action === 'agent_update' ? (
          <div className="space-y-1.5 py-2">
            <Label htmlFor="agent-version">Version (optional)</Label>
            <Input
              id="agent-version"
              autoFocus
              placeholder="latest"
              value={pending.version}
              onChange={(e) => setPending({ ...pending, version: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to install the latest available agent.
            </p>
          </div>
        ) : (
          <div className="py-2" />
        )}
      </Dialog>
    </div>
  );
}

const ACTIONS: Record<NodeActionKind, { title: string; verb: string; confirm: string }> = {
  reboot: {
    title: 'Reboot node',
    verb: 'Reboot',
    confirm: 'The node will restart. Apps come back up automatically once it boots.',
  },
  docker_prune: {
    title: 'Prune Docker',
    verb: 'Prune',
    confirm: 'Unused images, stopped containers and build cache will be removed to reclaim disk.',
  },
  agent_update: {
    title: 'Update agent',
    verb: 'Update',
    confirm: 'The YourStack agent will be updated. A brief reconnect is expected.',
  },
};

function ActionButton({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-muted/30 p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-muted"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function CommandOutput({ command }: { command: NodeCommand }) {
  const text =
    command.error ??
    (typeof command.output === 'string'
      ? command.output
      : command.output
        ? JSON.stringify(command.output)
        : null);
  if (!text) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <code
      className={cn(
        'block truncate font-mono text-xs',
        command.error ? 'text-danger' : 'text-muted-foreground',
      )}
      title={text}
    >
      {text}
    </code>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-sm text-foreground', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  );
}
