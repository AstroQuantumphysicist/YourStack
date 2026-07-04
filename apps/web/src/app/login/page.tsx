'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Github, Mail } from 'lucide-react';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, API_V1, ApiError } from '@/lib/api';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const devLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.devLogin(email.trim());
      router.push(next);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'forbidden'
            ? 'Dev login is disabled on this deployment. Use GitHub instead.'
            : err.message,
        );
      } else {
        setError('Could not sign in. Is the API running?');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="app-aurora flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="glass rounded-2xl border border-border p-7 shadow-card sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight">Sign in to YourStack</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Access your workspaces, nodes, and deployments.
            </p>

            <a href={`${API_V1}/auth/github`} className="mt-6 block">
              <Button className="w-full" size="lg" type="button">
                <Github className="h-4 w-4" /> Continue with GitHub
              </Button>
            </a>

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              or use dev sign-in
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={devLogin} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error ? (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              ) : null}
              <Button type="submit" variant="secondary" className="w-full" loading={submitting}>
                <Mail className="h-4 w-4" /> Sign in with email
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              Dev sign-in works only when the API runs in development
              (<code className="text-foreground">NODE_ENV=development</code>). In production, use
              GitHub.
            </p>
          </div>

          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
