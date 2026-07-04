'use client';

import { useState } from 'react';
import { Menu, Rocket, Search, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { SidebarNav } from './sidebar';
import { UserMenu } from './user-menu';
import { Breadcrumbs } from './breadcrumbs';
import { ThemeToggle } from '@/components/theme-toggle';
import { Wordmark } from '@/components/logo';
import { CommandPalette, openCommandPalette } from '@/components/command-palette';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, workspaces, loading } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Loading your workspace…" />
      </div>
    );
  }

  // Authenticated but has no workspace yet → onboarding.
  if (user && workspaces.length === 0) {
    return <Onboarding />;
  }

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border lg:block">
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="glass absolute inset-y-0 left-0 w-72 animate-fade-in border-r border-border">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="lg:pl-64">
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="lg:hidden">
            <Wordmark size={22} />
          </div>

          <div className="hidden lg:block">
            <Breadcrumbs />
          </div>

          <div className="flex flex-1 items-center justify-end gap-2">
            <button
              onClick={openCommandPalette}
              className="group inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-muted px-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:w-56 sm:justify-between"
              aria-label="Open command palette"
            >
              <span className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">Search…</span>
              </span>
              <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex">
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="app-aurora min-h-[calc(100vh-4rem)] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

function Onboarding() {
  const { addWorkspace } = useSession();
  const toast = useToast();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { workspace } = await api.createWorkspace(name.trim());
      addWorkspace(workspace);
      toast.success('Workspace created', 'Welcome to YourStack.');
    } catch (err) {
      toast.error('Could not create workspace', err instanceof ApiError ? err.message : undefined);
      setLoading(false);
    }
  };

  return (
    <div className="app-aurora flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="glass rounded-2xl border border-border p-8 shadow-card">
          <div className={cn('mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-muted text-primary')}>
            <Rocket className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Create your first workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workspaces hold your nodes, projects, apps, secrets, and team. Let&apos;s set one up.
          </p>
          <form onSubmit={create} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="onboard-name">Workspace name</Label>
              <Input
                id="onboard-name"
                autoFocus
                placeholder="Acme Platform"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" loading={loading} disabled={name.trim().length < 2}>
              Create workspace
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
