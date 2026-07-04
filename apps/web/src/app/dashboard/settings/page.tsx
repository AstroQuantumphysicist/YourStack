'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Activity,
  Copy,
  KeyRound,
  Settings as SettingsIcon,
  Trash2,
  Users,
} from 'lucide-react';
import type { ApiTokenDTO, AuditLogDTO, MemberDTO, WorkspaceRole } from '@noderail/shared';
import { WORKSPACE_ROLES } from '@noderail/shared';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Tabs } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { CopyButton } from '@/components/ui/copy-button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { formatDate, timeAgo } from '@/lib/format';

const TABS = [
  { value: 'general', label: 'General', icon: SettingsIcon },
  { value: 'members', label: 'Members', icon: Users },
  { value: 'tokens', label: 'API tokens', icon: KeyRound },
  { value: 'audit', label: 'Audit log', icon: Activity },
];

export default function SettingsPage() {
  const { workspace } = useSession();
  const [tab, setTab] = useState('general');
  const wid = workspace?.id;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage this workspace, its members, and access." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="animate-fade-in">
        {!wid ? (
          <SkeletonRows rows={3} />
        ) : tab === 'general' ? (
          <GeneralSection wid={wid} />
        ) : tab === 'members' ? (
          <MembersSection wid={wid} />
        ) : tab === 'tokens' ? (
          <TokensSection wid={wid} />
        ) : (
          <AuditSection wid={wid} />
        )}
      </div>
    </div>
  );
}

function GeneralSection({ wid }: { wid: string }) {
  const { workspace, refresh } = useSession();
  const toast = useToast();
  const [name, setName] = useState(workspace?.name ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateWorkspace(wid, name.trim());
      await refresh();
      toast.success('Workspace updated');
    } catch (err) {
      toast.error('Could not update workspace', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input value={workspace?.slug ?? ''} readOnly disabled />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="capitalize">
            Plan: {workspace?.planKey}
          </Badge>
          <Badge variant="outline" className="capitalize">
            Your role: {workspace?.role}
          </Badge>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} loading={saving} disabled={name.trim().length < 2}>
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MembersSection({ wid }: { wid: string }) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ members: MemberDTO[] }>(
    `/workspaces/${wid}/members`,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('developer');
  const [inviting, setInviting] = useState(false);

  const members = data?.members ?? [];

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      await api.inviteMember(wid, email.trim(), role);
      toast.success('Member invited', email.trim());
      setEmail('');
      setInviteOpen(false);
      mutate();
    } catch (err) {
      toast.error('Could not invite member', err instanceof ApiError ? err.message : undefined);
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (m: MemberDTO, newRole: string) => {
    try {
      await api.updateMemberRole(wid, m.id, newRole);
      toast.success('Role updated', `${m.email} → ${newRole}`);
      mutate();
    } catch (err) {
      toast.error('Could not update role', err instanceof ApiError ? err.message : undefined);
      mutate();
    }
  };

  const remove = async (m: MemberDTO) => {
    if (!confirm(`Remove ${m.email} from the workspace?`)) return;
    try {
      await api.removeMember(wid, m.id);
      toast.success('Member removed', m.email);
      mutate();
    } catch (err) {
      toast.error('Could not remove member', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Members</CardTitle>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          Invite member
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Member</TH>
                <TH>Role</TH>
                <TH>Joined</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {members.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar src={m.avatarUrl} name={m.name} email={m.email} size={30} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {m.name ?? m.email}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      className="h-8 w-32 capitalize"
                    >
                      {WORKSPACE_ROLES.map((r: WorkspaceRole) => (
                        <option key={r} value={r} className="capitalize">
                          {r}
                        </option>
                      ))}
                    </Select>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(m.createdAt)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(m)}>
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite member"
        description="They'll gain access to this workspace with the selected role."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={invite} loading={inviting} disabled={!email.trim()}>
              Send invite
            </Button>
          </>
        }
      >
        <form onSubmit={invite} className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoFocus
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
            </Select>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

function TokensSection({ wid }: { wid: string }) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ tokens: ApiTokenDTO[] }>(
    `/workspaces/${wid}/tokens`,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const tokens = data?.tokens ?? [];

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.createToken(wid, name.trim());
      setPlaintext(res.plaintext);
      setName('');
      mutate();
    } catch (err) {
      toast.error('Could not create token', err instanceof ApiError ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (t: ApiTokenDTO) => {
    if (!confirm(`Revoke token "${t.name}"? Any client using it will stop working.`)) return;
    try {
      await api.revokeToken(wid, t.id);
      toast.success('Token revoked', t.name);
      mutate();
    } catch (err) {
      toast.error('Could not revoke token', err instanceof ApiError ? err.message : undefined);
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setPlaintext(null);
    setName('');
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>API tokens</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Create token
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonRows rows={2} />
        ) : tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API tokens"
            description="Create a token to authenticate the CLI or CI with this workspace."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Token</TH>
                <TH>Last used</TH>
                <TH>Expires</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {tokens.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium text-foreground">{t.name}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">nr_…{t.lastFour}</TD>
                  <TD className="text-xs text-muted-foreground">
                    {t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'never'}
                  </TD>
                  <TD className="text-xs text-muted-foreground">
                    {t.expiresAt ? formatDate(t.expiresAt) : 'never'}
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => revoke(t)}>
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={createOpen}
        onClose={closeCreate}
        title="Create API token"
        description="Tokens carry your workspace access. Store them securely."
        footer={
          plaintext ? (
            <Button onClick={closeCreate}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeCreate}>
                Cancel
              </Button>
              <Button onClick={create} loading={creating} disabled={!name.trim()}>
                Create token
              </Button>
            </>
          )
        }
      >
        {plaintext ? (
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
              <Copy className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Copy this token now — it will not be shown again.</p>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-[hsl(224_44%_3%)] p-3">
              <code className="truncate font-mono text-xs text-foreground">{plaintext}</code>
              <CopyButton value={plaintext} label="Copy" />
            </div>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                autoFocus
                placeholder="ci-deploy"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </form>
        )}
      </Dialog>
    </Card>
  );
}

function AuditSection({ wid }: { wid: string }) {
  const { data, isLoading } = useSWR<{ logs: AuditLogDTO[] }>(`/workspaces/${wid}/audit?limit=100`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <SkeletonRows rows={6} /> : <ActivityFeed logs={data?.logs ?? []} />}
      </CardContent>
    </Card>
  );
}
