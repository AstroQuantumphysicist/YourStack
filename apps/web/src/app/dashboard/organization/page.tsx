'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Building2,
  Boxes,
  ChevronRight,
  Plus,
  Trash2,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  OrganizationDTO,
  OrgMemberDTO,
  TeamDTO,
  TeamMemberDTO,
  WorkspaceDTO,
} from '@yourstack/shared';
import { OrgRole, TeamRole } from '@yourstack/shared';
import { useOrg } from '@/lib/org';
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
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, LoadingBlock } from '@/components/ui/states';
import { EmptyIllustration } from '@/components/dashboard/empty-illustration';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const TABS = [
  { value: 'members', label: 'Members', icon: Users },
  { value: 'teams', label: 'Teams', icon: UsersRound },
  { value: 'workspaces', label: 'Workspaces', icon: Boxes },
];

export default function OrganizationPage() {
  const { organization, organizations, loaded, loading } = useOrg();
  const [tab, setTab] = useState('members');

  if (loading && !loaded) {
    return <LoadingBlock label="Loading organizations…" />;
  }

  if (loaded && organizations.length === 0) {
    return <OrgOnboarding />;
  }

  if (!organization) {
    return <LoadingBlock label="Selecting organization…" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
              <Building2 className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            </span>
            {organization.name}
          </span>
        }
        description="Manage members, teams, and the workspaces this organization owns."
        actions={
          <Badge variant="outline" className="capitalize">
            Your role: {organization.role}
          </Badge>
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="animate-fade-in">
        {tab === 'members' ? (
          <MembersSection org={organization} />
        ) : tab === 'teams' ? (
          <TeamsSection org={organization} />
        ) : (
          <WorkspacesSection org={organization} />
        )}
      </div>
    </div>
  );
}

function OrgOnboarding() {
  const { addOrganization } = useOrg();
  const toast = useToast();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { organization } = await api.createOrganization(name.trim());
      addOrganization(organization);
      toast.success('Organization created', organization.name);
    } catch (err) {
      toast.error('Could not create organization', err instanceof ApiError ? err.message : undefined);
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <EmptyIllustration
        icon={Building2}
        title="Create your organization"
        description="Organizations group your workspaces and let you manage teams and shared access in one place."
      />
      <form onSubmit={create} className="mt-6 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="org-onboard">Organization name</Label>
          <Input
            id="org-onboard"
            autoFocus
            placeholder="Acme Inc."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" loading={loading} disabled={name.trim().length < 2}>
          Create organization
        </Button>
      </form>
    </div>
  );
}

/* --------------------------------- Members --------------------------------- */

function MembersSection({ org }: { org: OrganizationDTO }) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ members: OrgMemberDTO[] }>(
    `/organizations/${org.id}/members`,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>(OrgRole.MEMBER);
  const [inviting, setInviting] = useState(false);

  const members = data?.members ?? [];

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      await api.inviteOrgMember(org.id, email.trim(), role);
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

  const changeRole = async (m: OrgMemberDTO, newRole: string) => {
    try {
      await api.updateOrgMember(org.id, m.id, newRole);
      toast.success('Role updated', `${m.email} → ${newRole}`);
      mutate();
    } catch (err) {
      toast.error('Could not update role', err instanceof ApiError ? err.message : undefined);
      mutate();
    }
  };

  const remove = async (m: OrgMemberDTO) => {
    if (!confirm(`Remove ${m.email} from ${org.name}?`)) return;
    try {
      await api.removeOrgMember(org.id, m.id);
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
          <Plus className="h-4 w-4" /> Invite member
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title="No members" description="Invite people to your organization." />
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
                      <option value={OrgRole.OWNER}>Owner</option>
                      <option value={OrgRole.ADMIN}>Admin</option>
                      <option value={OrgRole.MEMBER}>Member</option>
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
        title="Invite to organization"
        description="They'll join the organization with the selected role."
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
            <Label htmlFor="org-invite-email">Email</Label>
            <Input
              id="org-invite-email"
              type="email"
              autoFocus
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-invite-role">Role</Label>
            <Select id="org-invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value={OrgRole.ADMIN}>Admin</option>
              <option value={OrgRole.MEMBER}>Member</option>
            </Select>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/* ---------------------------------- Teams ---------------------------------- */

function TeamsSection({ org }: { org: OrganizationDTO }) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ teams: TeamDTO[] }>(
    `/organizations/${org.id}/teams`,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const teams = data?.teams ?? [];
  const selected = teams.find((t) => t.id === selectedId) ?? null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { team } = await api.createTeam(org.id, name.trim());
      toast.success('Team created', team.name);
      setName('');
      setCreateOpen(false);
      setSelectedId(team.id);
      mutate();
    } catch (err) {
      toast.error('Could not create team', err instanceof ApiError ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const removeTeam = async (t: TeamDTO) => {
    if (!confirm(`Delete team "${t.name}"?`)) return;
    try {
      await api.deleteTeam(t.id);
      toast.success('Team deleted', t.name);
      if (selectedId === t.id) setSelectedId(null);
      mutate();
    } catch (err) {
      toast.error('Could not delete team', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Teams</CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonRows rows={3} />
          ) : teams.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="No teams"
              description="Group members and grant them workspace access as a unit."
            />
          ) : (
            <div className="space-y-1.5">
              {teams.map((t) => {
                const active = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border hover:border-primary/30',
                    )}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
                      <UsersRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.memberCount} members · {t.workspaceGrants.length} grants
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <TeamDetail
          key={selected.id}
          org={org}
          team={selected}
          onDelete={() => removeTeam(selected)}
          onChanged={() => mutate()}
        />
      ) : (
        <Card className="flex items-center justify-center">
          <div className="p-10 text-center text-sm text-muted-foreground">
            Select a team to manage its members and workspace access.
          </div>
        </Card>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create team"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={creating} disabled={name.trim().length < 2}>
              Create team
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              autoFocus
              placeholder="Platform"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function TeamDetail({
  org,
  team,
  onDelete,
  onChanged,
}: {
  org: OrganizationDTO;
  team: TeamDTO;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const members = useSWR<{ members: TeamMemberDTO[] }>(`/teams/${team.id}/members`);
  const orgMembers = useSWR<{ members: OrgMemberDTO[] }>(`/organizations/${org.id}/members`);
  const orgWorkspaces = useSWR<{ workspaces: WorkspaceDTO[] }>(
    `/organizations/${org.id}/workspaces`,
  );

  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<string>(TeamRole.MEMBER);
  const [grantWid, setGrantWid] = useState('');
  const [grantRole, setGrantRole] = useState<string>('developer');

  const teamMembers = members.data?.members ?? [];
  const memberIds = new Set(teamMembers.map((m) => m.userId));
  const availableMembers = (orgMembers.data?.members ?? []).filter((m) => !memberIds.has(m.userId));
  const workspaces = orgWorkspaces.data?.workspaces ?? [];
  const grantedIds = new Set(team.workspaceGrants.map((g) => g.workspaceId));
  const grantableWorkspaces = workspaces.filter((w) => !grantedIds.has(w.id));

  const addMember = async () => {
    if (!addUserId) return;
    try {
      await api.addTeamMember(team.id, addUserId, addRole);
      toast.success('Member added');
      setAddUserId('');
      members.mutate();
      onChanged();
    } catch (err) {
      toast.error('Could not add member', err instanceof ApiError ? err.message : undefined);
    }
  };

  const removeMember = async (m: TeamMemberDTO) => {
    try {
      await api.removeTeamMember(team.id, m.userId);
      toast.success('Member removed');
      members.mutate();
      onChanged();
    } catch (err) {
      toast.error('Could not remove member', err instanceof ApiError ? err.message : undefined);
    }
  };

  const grant = async () => {
    if (!grantWid) return;
    try {
      await api.grantTeamWorkspace(team.id, grantWid, grantRole);
      toast.success('Workspace access granted');
      setGrantWid('');
      onChanged();
    } catch (err) {
      toast.error('Could not grant access', err instanceof ApiError ? err.message : undefined);
    }
  };

  const revoke = async (workspaceId: string) => {
    try {
      await api.revokeTeamWorkspace(team.id, workspaceId);
      toast.success('Access revoked');
      onChanged();
    } catch (err) {
      toast.error('Could not revoke access', err instanceof ApiError ? err.message : undefined);
    }
  };

  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id.slice(0, 8);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-primary" /> {team.name}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-danger" /> Delete team
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Members */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Members</h4>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              className="h-9 flex-1"
            >
              <option value="">Add a member…</option>
              {availableMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
            <Select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="h-9 w-28 capitalize">
              <option value={TeamRole.MEMBER}>Member</option>
              <option value={TeamRole.LEAD}>Lead</option>
            </Select>
            <Button size="sm" onClick={addMember} disabled={!addUserId}>
              Add
            </Button>
          </div>
          {teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members in this team yet.</p>
          ) : (
            <div className="space-y-1.5">
              {teamMembers.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                >
                  <Avatar name={m.name} email={m.email} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.name ?? m.email}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {m.role}
                  </Badge>
                  <button
                    onClick={() => removeMember(m)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    aria-label="Remove member"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Workspace grants */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Workspace access</h4>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={grantWid}
              onChange={(e) => setGrantWid(e.target.value)}
              className="h-9 flex-1"
            >
              <option value="">Grant a workspace…</option>
              {grantableWorkspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Select
              value={grantRole}
              onChange={(e) => setGrantRole(e.target.value)}
              className="h-9 w-32 capitalize"
            >
              <option value="admin">Admin</option>
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
            </Select>
            <Button size="sm" onClick={grant} disabled={!grantWid}>
              Grant
            </Button>
          </div>
          {team.workspaceGrants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workspace access granted. Members inherit access from grants above.
            </p>
          ) : (
            <div className="space-y-1.5">
              {team.workspaceGrants.map((g) => (
                <div
                  key={g.workspaceId}
                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-muted text-primary">
                    <Boxes className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {wsName(g.workspaceId)}
                  </span>
                  <Badge variant="primary" className="capitalize">
                    {g.role}
                  </Badge>
                  <button
                    onClick={() => revoke(g.workspaceId)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    aria-label="Revoke access"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Workspaces -------------------------------- */

function WorkspacesSection({ org }: { org: OrganizationDTO }) {
  const { data, isLoading } = useSWR<{ workspaces: WorkspaceDTO[] }>(
    `/organizations/${org.id}/workspaces`,
  );
  const workspaces = data?.workspaces ?? [];

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Workspaces</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : workspaces.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No workspaces"
            description="This organization doesn't own any workspaces yet."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Workspace</TH>
                <TH>Plan</TH>
                <TH>Your role</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {workspaces.map((w) => (
                <TR key={w.id}>
                  <TD className="font-medium text-foreground">{w.name}</TD>
                  <TD>
                    <Badge variant="outline" className="capitalize">
                      {w.planKey}
                    </Badge>
                  </TD>
                  <TD className="capitalize text-sm text-muted-foreground">{w.role}</TD>
                  <TD className="text-right">
                    <Link
                      href="/dashboard/settings"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      Manage <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
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
