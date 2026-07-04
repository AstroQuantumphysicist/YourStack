'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ListPlus,
  Play,
  Plus,
  Save,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { FirewallDTO, NodeDTO } from '@yourstack/shared';
import { FirewallAction, FirewallDirection, FirewallProtocol } from '@yourstack/shared';
import { api, ApiError } from '@/lib/api';
import {
  FIREWALL_PRESETS,
  makeRule,
  type DraftRule,
} from '@/lib/firewall-presets';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/utils';

function toDraft(fw: FirewallDTO): DraftRule[] {
  return fw.rules.map((r) => ({
    id: r.id,
    direction: r.direction,
    action: r.action,
    protocol: r.protocol,
    port: r.port ?? '',
    cidr: r.cidr,
    comment: r.comment ?? '',
  }));
}

export default function FirewallDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR<{ firewall: FirewallDTO }>(`/firewalls/${id}`);
  const fw = data?.firewall;

  const nodes = useSWR<{ nodes: NodeDTO[] }>(
    fw ? `/workspaces/${fw.workspaceId}/nodes` : null,
  );

  const [rules, setRules] = useState<DraftRule[]>([]);
  const [defaultInbound, setDefaultInbound] = useState<string>(FirewallAction.DENY);
  const [defaultOutbound, setDefaultOutbound] = useState<string>(FirewallAction.ALLOW);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  // Seed the local draft whenever the server copy changes identity.
  useEffect(() => {
    if (!fw) return;
    setRules(toDraft(fw));
    setDefaultInbound(fw.defaultInbound);
    setDefaultOutbound(fw.defaultOutbound);
    setNodeIds(fw.nodeIds);
  }, [fw]);

  const dirty = useMemo(() => {
    if (!fw) return false;
    const server = JSON.stringify({
      rules: toDraft(fw).map(({ id: _id, ...r }) => r),
      defaultInbound: fw.defaultInbound,
      defaultOutbound: fw.defaultOutbound,
      nodeIds: [...fw.nodeIds].sort(),
    });
    const local = JSON.stringify({
      rules: rules.map(({ id: _id, ...r }) => r),
      defaultInbound,
      defaultOutbound,
      nodeIds: [...nodeIds].sort(),
    });
    return server !== local;
  }, [fw, rules, defaultInbound, defaultOutbound, nodeIds]);

  const updateRule = (rid: string, patch: Partial<DraftRule>) =>
    setRules((prev) => prev.map((r) => (r.id === rid ? { ...r, ...patch } : r)));
  const removeRule = (rid: string) => setRules((prev) => prev.filter((r) => r.id !== rid));
  const addRule = () => setRules((prev) => [...prev, makeRule()]);
  const appendPreset = (key: string) => {
    const preset = FIREWALL_PRESETS.find((p) => p.key === key);
    if (preset) setRules((prev) => [...prev, ...preset.rules()]);
  };
  const move = (index: number, delta: number) =>
    setRules((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const toggleNode = (nid: string) =>
    setNodeIds((prev) => (prev.includes(nid) ? prev.filter((n) => n !== nid) : [...prev, nid]));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateFirewall(id, {
        defaultInbound,
        defaultOutbound,
        nodeIds,
        rules: rules.map((r) => ({
          direction: r.direction,
          action: r.action,
          protocol: r.protocol,
          port: r.port.trim() || null,
          cidr: r.cidr.trim() || '0.0.0.0/0',
          comment: r.comment.trim() || null,
        })),
      });
      toast.success('Firewall saved');
      mutate();
    } catch (err) {
      toast.error('Could not save firewall', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const apply = async () => {
    if (dirty && !confirm('Apply will push the last saved rules to your nodes. Save first?')) return;
    setApplying(true);
    try {
      await api.applyFirewall(id);
      toast.success('Applying firewall', 'Pushing rules to attached nodes.');
      mutate();
    } catch (err) {
      toast.error('Could not apply firewall', err instanceof ApiError ? err.message : undefined);
    } finally {
      setApplying(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this firewall? Its rules will be removed from attached nodes.')) return;
    try {
      await api.deleteFirewall(id);
      toast.success('Firewall deleted');
      router.push('/dashboard/firewalls');
    } catch (err) {
      toast.error('Could not delete firewall', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error && !fw) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message="Could not load firewall." onRetry={() => mutate()} />
      </div>
    );
  }

  const nodeList = nodes.data?.nodes ?? [];

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isLoading || !fw ? <Skeleton className="h-7 w-40" /> : fw.name}
            {fw ? <StatusBadge kind="firewall" status={fw.status} /> : null}
          </span>
        }
        description={
          fw ? `${fw.rules.length} rules · ${fw.nodeIds.length} nodes attached` : undefined
        }
        actions={
          fw ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" loading={saving} disabled={!dirty} onClick={save}>
                <Save className="h-4 w-4" /> Save
              </Button>
              <Button size="sm" loading={applying} onClick={apply}>
                <Play className="h-4 w-4" /> Apply
              </Button>
              <Button variant="danger" size="icon" onClick={remove} aria-label="Delete firewall">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : undefined
        }
      />

      {!fw ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <>
          {dirty ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-2.5 text-sm text-warning">
              <span>You have unsaved changes.</span>
              <Button size="sm" variant="outline" loading={saving} onClick={save}>
                Save changes
              </Button>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Default policy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <PolicyToggle
                  label="Inbound"
                  help="Traffic reaching your nodes that no rule matches."
                  value={defaultInbound}
                  onChange={setDefaultInbound}
                />
                <PolicyToggle
                  label="Outbound"
                  help="Traffic leaving your nodes that no rule matches."
                  value={defaultOutbound}
                  onChange={setDefaultOutbound}
                />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" /> Attached nodes
                </CardTitle>
                <Badge variant="outline">{nodeIds.length} selected</Badge>
              </CardHeader>
              <CardContent>
                {nodeList.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    No nodes in this workspace yet.
                  </p>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2">
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
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {n.name}
                          </span>
                          <StatusBadge kind="node" status={n.status} />
                        </label>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <ListPlus className="h-4 w-4 text-primary" /> Rules
              </CardTitle>
              <div className="flex items-center gap-2">
                <Dropdown
                  align="end"
                  trigger={
                    <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted">
                      Add preset
                    </span>
                  }
                >
                  {(close) => (
                    <>
                      <DropdownLabel>Append preset rules</DropdownLabel>
                      {FIREWALL_PRESETS.filter((p) => p.rules().length > 0).map((p) => (
                        <DropdownItem
                          key={p.key}
                          onClick={() => {
                            appendPreset(p.key);
                            close();
                          }}
                        >
                          {p.label}
                        </DropdownItem>
                      ))}
                    </>
                  )}
                </Dropdown>
                <Button size="sm" onClick={addRule}>
                  <Plus className="h-4 w-4" /> Add rule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-surface-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No rules. With default inbound{' '}
                  <span className="font-medium text-foreground">{defaultInbound}</span>, all
                  unmatched inbound traffic is {defaultInbound === 'deny' ? 'blocked' : 'allowed'}.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="hidden grid-cols-[auto_7rem_6rem_6rem_1fr_1.4fr_auto] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 lg:grid">
                    <span>Order</span>
                    <span>Direction</span>
                    <span>Action</span>
                    <span>Protocol</span>
                    <span>Port(s)</span>
                    <span>Source CIDR</span>
                    <span />
                  </div>
                  {rules.map((r, i) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      first={i === 0}
                      last={i === rules.length - 1}
                      onChange={(patch) => updateRule(r.id, patch)}
                      onRemove={() => removeRule(r.id)}
                      onMoveUp={() => move(i, -1)}
                      onMoveDown={() => move(i, 1)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function PolicyToggle({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5">
          {[FirewallAction.ALLOW, FirewallAction.DENY].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors',
                value === opt
                  ? opt === FirewallAction.DENY
                    ? 'bg-danger/15 text-danger'
                    : 'bg-success/15 text-success'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

function RuleRow({
  rule,
  first,
  last,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  rule: DraftRule;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DraftRule>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const deny = rule.action === FirewallAction.DENY;
  return (
    <div
      className={cn(
        'grid grid-cols-2 items-center gap-2 rounded-xl border border-border bg-surface-muted/30 p-2.5 lg:grid-cols-[auto_7rem_6rem_6rem_1fr_1.4fr_auto]',
        deny && 'border-danger/25',
      )}
    >
      <div className="flex items-center gap-0.5 lg:flex-col lg:gap-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={first}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          aria-label="Move up"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={last}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          aria-label="Move down"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <Select
        value={rule.direction}
        onChange={(e) => onChange({ direction: e.target.value })}
        className="h-8 capitalize"
        aria-label="Direction"
      >
        <option value={FirewallDirection.INBOUND}>Inbound</option>
        <option value={FirewallDirection.OUTBOUND}>Outbound</option>
      </Select>
      <Select
        value={rule.action}
        onChange={(e) => onChange({ action: e.target.value })}
        className={cn('h-8 capitalize', deny ? 'text-danger' : 'text-success')}
        aria-label="Action"
      >
        <option value={FirewallAction.ALLOW}>Allow</option>
        <option value={FirewallAction.DENY}>Deny</option>
      </Select>
      <Select
        value={rule.protocol}
        onChange={(e) => onChange({ protocol: e.target.value })}
        className="h-8 uppercase"
        aria-label="Protocol"
      >
        <option value={FirewallProtocol.TCP}>TCP</option>
        <option value={FirewallProtocol.UDP}>UDP</option>
        <option value={FirewallProtocol.ICMP}>ICMP</option>
        <option value={FirewallProtocol.ANY}>Any</option>
      </Select>
      <Input
        value={rule.port}
        onChange={(e) => onChange({ port: e.target.value })}
        placeholder="443 or 8000-8100"
        className="h-8"
        disabled={rule.protocol === FirewallProtocol.ICMP}
        aria-label="Port"
      />
      <Input
        value={rule.cidr}
        onChange={(e) => onChange({ cidr: e.target.value })}
        placeholder="0.0.0.0/0"
        className="h-8 font-mono text-xs"
        aria-label="CIDR"
      />
      <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
        <Input
          value={rule.comment}
          onChange={(e) => onChange({ comment: e.target.value })}
          placeholder="Comment"
          className="h-8"
          aria-label="Comment"
        />
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label="Remove rule"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/firewalls"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> All firewalls
    </Link>
  );
}
