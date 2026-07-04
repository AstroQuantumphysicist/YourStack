'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, Check, ChevronsUpDown, Plus, Settings } from 'lucide-react';
import { useOrg } from '@/lib/org';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function OrgSwitcher() {
  const { organizations, organization, setOrganization, addOrganization } = useOrg();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { organization: org } = await api.createOrganization(name.trim());
      addOrganization(org);
      toast.success('Organization created', org.name);
      setOpen(false);
      setName('');
    } catch (err) {
      toast.error(
        'Could not create organization',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Dropdown
        align="start"
        className="w-full"
        trigger={
          <div className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface-muted/60 px-2.5 py-1.5 text-left transition-colors hover:border-primary/40">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-primary">
              <Building2 className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Organization
              </p>
              <p className="truncate text-sm font-medium text-foreground">
                {organization?.name ?? 'No organization'}
              </p>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        }
        menuClassName="w-[15rem]"
      >
        {(close) => (
          <>
            {organizations.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">No organizations yet.</p>
            ) : (
              organizations.map((org) => (
                <DropdownItem
                  key={org.id}
                  onClick={() => {
                    setOrganization(org.id);
                    close();
                  }}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-surface-muted text-primary">
                    <Building2 className="h-3 w-3" />
                  </span>
                  <span className="flex-1 truncate">{org.name}</span>
                  {org.id === organization?.id ? (
                    <Check className={cn('h-4 w-4 text-primary')} />
                  ) : null}
                </DropdownItem>
              ))
            )}
            <DropdownSeparator />
            <Link href="/dashboard/organization" onClick={close}>
              <DropdownItem className="w-full">
                <Settings className="h-4 w-4" /> Organization settings
              </DropdownItem>
            </Link>
            <DropdownItem
              onClick={() => {
                close();
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New organization
            </DropdownItem>
          </>
        )}
      </Dropdown>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create organization"
        description="An organization groups your workspaces, teams, and members."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={creating} disabled={name.trim().length < 2}>
              Create organization
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              autoFocus
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </form>
      </Dialog>
    </>
  );
}
