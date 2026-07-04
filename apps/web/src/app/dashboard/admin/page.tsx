'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Activity,
  Boxes,
  Building2,
  Rocket,
  Server,
  Shield,
  ShieldOff,
  Signal,
  Users,
} from 'lucide-react';
import type { AuditLogDTO } from '@noderail/shared';
import { useSession } from '@/lib/session';
import {
  api,
  ApiError,
  type AdminNode,
  type AdminStats,
  type AdminUser,
  type AdminWorkspace,
} from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Tabs } from '@/components/ui/tabs';
import { StatCard } from '@/components/dashboard/stat-card';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { formatDate, timeAgo } from '@/lib/format';

const TABS = [
  { value: 'overview', label: 'Overview', icon: Activity },
  { value: 'workspaces', label: 'Workspaces', icon: Building2 },
  { value: 'users', label: 'Users', icon: Users },
  { value: 'nodes', label: 'Nodes', icon: Server },
  { value: 'audit', label: 'Audit', icon: Shield },
];

export default function AdminPage() {
  const { user, loading } = useSession();
  const [tab, setTab] = useState('overview');

  if (loading) return <SkeletonRows rows={4} />;

  if (!user?.isPlatformAdmin) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Admin access required"
        description="This area is restricted to platform administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Platform admin
          </span>
        }
        description="Cross-tenant visibility and kill switches for the whole platform."
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="animate-fade-in">
        {tab === 'overview' ? (
          <OverviewSection />
        ) : tab === 'workspaces' ? (
          <WorkspacesSection />
        ) : tab === 'users' ? (
          <UsersSection />
        ) : tab === 'nodes' ? (
          <NodesSection />
        ) : (
          <AuditSection />
        )}
      </div>
    </div>
  );
}

function OverviewSection() {
  const { data, isLoading } = useSWR<{ stats: AdminStats }>('/admin/stats', () => api.adminStats());
  const s = data?.stats;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      <StatCard label="Users" value={s?.users ?? 0} icon={Users} loading={isLoading} />
      <StatCard label="Workspaces" value={s?.workspaces ?? 0} icon={Building2} loading={isLoading} />
      <StatCard label="Apps" value={s?.apps ?? 0} icon={Boxes} loading={isLoading} />
      <StatCard label="Nodes" value={s?.nodes ?? 0} icon={Server} loading={isLoading} />
      <StatCard
        label="Online nodes"
        value={s?.onlineNodes ?? 0}
        icon={Signal}
        accent="success"
        loading={isLoading}
      />
      <StatCard
        label="Deployments"
        value={s?.deployments ?? 0}
        icon={Rocket}
        accent="info"
        loading={isLoading}
      />
    </div>
  );
}

function WorkspacesSection() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ workspaces: AdminWorkspace[] }>(
    '/admin/workspaces',
    () => api.adminWorkspaces(),
  );

  const toggle = async (w: AdminWorkspace) => {
    const suspend = w.status !== 'suspended';
    if (!confirm(`${suspend ? 'Suspend' : 'Reactivate'} workspace "${w.name}"?`)) return;
    try {
      await api.suspendWorkspace(w.id, suspend);
      toast.success(suspend ? 'Workspace suspended' : 'Workspace reactivated', w.name);
      mutate();
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-5">
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Workspace</TH>
                <TH>Status</TH>
                <TH>Plan</TH>
                <TH>Members</TH>
                <TH>Nodes</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {(data?.workspaces ?? []).map((w) => (
                <TR key={w.id}>
                  <TD>
                    <p className="font-medium text-foreground">{w.name}</p>
                    <p className="text-xs text-muted-foreground">{w.slug}</p>
                  </TD>
                  <TD>
                    <Badge variant={w.status === 'suspended' ? 'danger' : 'success'} className="capitalize">
                      {w.status}
                    </Badge>
                  </TD>
                  <TD className="text-xs capitalize text-muted-foreground">{w.planKey}</TD>
                  <TD className="text-muted-foreground">{w.members}</TD>
                  <TD className="text-muted-foreground">{w.nodes}</TD>
                  <TD className="text-right">
                    <Button
                      variant={w.status === 'suspended' ? 'outline' : 'danger'}
                      size="sm"
                      onClick={() => toggle(w)}
                    >
                      {w.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function UsersSection() {
  const { data, isLoading } = useSWR<{ users: AdminUser[] }>('/admin/users', () => api.adminUsers());
  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-5">
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Joined</TH>
              </TR>
            </THead>
            <TBody>
              {(data?.users ?? []).map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} email={u.email} size={30} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {u.name ?? u.email}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {u.isPlatformAdmin ? (
                      <Badge variant="primary" className="gap-1">
                        <Shield className="h-3 w-3" /> Admin
                      </Badge>
                    ) : (
                      <Badge variant="default">User</Badge>
                    )}
                  </TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function NodesSection() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ nodes: AdminNode[] }>('/admin/nodes', () =>
    api.adminNodes(),
  );

  const toggle = async (n: AdminNode) => {
    const disable = !n.disabled;
    if (!confirm(`${disable ? 'Disable' : 'Enable'} node "${n.name}"?`)) return;
    try {
      await api.disableNode(n.id, disable);
      toast.success(disable ? 'Node disabled' : 'Node enabled', n.name);
      mutate();
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-5">
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Node</TH>
                <TH>Workspace</TH>
                <TH>Status</TH>
                <TH>Heartbeat</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {(data?.nodes ?? []).map((n) => (
                <TR key={n.id}>
                  <TD className="font-medium text-foreground">{n.name}</TD>
                  <TD className="text-xs text-muted-foreground">{n.workspace}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={
                          n.status === 'online' ? 'success' : n.status === 'offline' ? 'danger' : 'warning'
                        }
                        className="capitalize"
                      >
                        {n.status}
                      </Badge>
                      {n.disabled ? <Badge variant="danger">disabled</Badge> : null}
                    </div>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{timeAgo(n.lastHeartbeatAt)}</TD>
                  <TD className="text-right">
                    <Button
                      variant={n.disabled ? 'outline' : 'danger'}
                      size="sm"
                      onClick={() => toggle(n)}
                    >
                      {n.disabled ? 'Enable' : 'Disable'}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AuditSection() {
  const { data, isLoading } = useSWR<{ logs: AuditLogDTO[] }>('/admin/audit', () => api.adminAudit());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform audit log</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <SkeletonRows rows={8} /> : <ActivityFeed logs={data?.logs ?? []} />}
      </CardContent>
    </Card>
  );
}
