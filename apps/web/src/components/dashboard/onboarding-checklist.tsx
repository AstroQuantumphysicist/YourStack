'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Rocket, X } from 'lucide-react';
import type { WorkspaceStatsDTO } from '@yourstack/shared';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'yourstack-onboarding-dismissed';

interface Step {
  key: string;
  title: string;
  href: string;
  done: (s: WorkspaceStatsDTO) => boolean;
}

const STEPS: Step[] = [
  { key: 'node', title: 'Join your first node', href: '/dashboard/nodes', done: (s) => s.nodes > 0 },
  { key: 'app', title: 'Deploy an app', href: '/dashboard/apps?new=1', done: (s) => s.apps > 0 },
  { key: 'db', title: 'Provision a database', href: '/dashboard/data?new=1', done: (s) => s.databases > 0 },
  { key: 'bucket', title: 'Create a storage bucket', href: '/dashboard/storage?new=1', done: (s) => s.buckets > 0 },
];

export function OnboardingChecklist({ stats }: { stats: WorkspaceStatsDTO | undefined }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!stats || dismissed) return null;

  const completed = STEPS.filter((step) => step.done(stats)).length;
  if (completed === STEPS.length) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const pct = Math.round((completed / STEPS.length) * 100);

  return (
    <div className="glass relative overflow-hidden rounded-2xl border border-border p-5 shadow-card">
      <div className="app-aurora pointer-events-none absolute inset-0 -z-10 opacity-60" />
      <button
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss onboarding"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-muted text-primary">
          <Rocket className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">Get set up</h3>
          <p className="text-sm text-muted-foreground">
            {completed} of {STEPS.length} steps done — you&apos;re {pct}% there.
          </p>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {STEPS.map((step) => {
          const done = step.done(stats);
          return (
            <Link
              key={step.key}
              href={step.href}
              className={cn(
                'group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                done
                  ? 'border-success/30 bg-success/5'
                  : 'border-border hover:border-primary/40',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                  done ? 'border-success bg-success text-white' : 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <span className="text-[11px]">{STEPS.indexOf(step) + 1}</span>}
              </span>
              <span className={cn('flex-1 text-sm', done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {step.title}
              </span>
              {!done ? (
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
