'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function WorkspaceSwitcher() {
  const { workspaces, workspace, setWorkspace, addWorkspace } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { workspace: ws } = await api.createWorkspace(name.trim());
      addWorkspace(ws);
      toast.success('Workspace created', ws.name);
      setOpen(false);
      setName('');
    } catch (err) {
      toast.error('Could not create workspace', err instanceof ApiError ? err.message : undefined);
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
          <div className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface-muted px-2.5 py-2 text-left transition-colors hover:border-primary/40">
            <Avatar name={workspace?.name} size={30} className="rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {workspace?.name ?? 'Select workspace'}
              </p>
              <p className="truncate text-xs capitalize text-muted-foreground">
                {workspace ? `${workspace.role} · ${workspace.planKey}` : '—'}
              </p>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        }
        menuClassName="w-[15rem]"
      >
        {(close) => (
          <>
            {workspaces.map((ws) => (
              <DropdownItem
                key={ws.id}
                onClick={() => {
                  setWorkspace(ws.id);
                  close();
                }}
              >
                <Avatar name={ws.name} size={22} className="rounded-md" />
                <span className="flex-1 truncate">{ws.name}</span>
                {ws.id === workspace?.id ? (
                  <Check className={cn('h-4 w-4 text-primary')} />
                ) : null}
              </DropdownItem>
            ))}
            <DropdownSeparator />
            <DropdownItem
              onClick={() => {
                close();
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New workspace
            </DropdownItem>
          </>
        )}
      </Dropdown>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create workspace"
        description="A workspace groups your nodes, projects, apps, and members."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={creating} disabled={name.trim().length < 2}>
              Create workspace
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              autoFocus
              placeholder="Acme Platform"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </form>
      </Dialog>
    </>
  );
}
