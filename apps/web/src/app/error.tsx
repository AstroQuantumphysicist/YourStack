'use client';

import { useEffect } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for observability during development.
    console.error(error);
  }, [error]);

  return (
    <div className="app-aurora flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
        <TriangleAlert className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        An unexpected error occurred while rendering this page. You can try again, or head back to
        the dashboard.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground/70">ref: {error.digest}</p>
      ) : null}
      <div className="mt-8 flex gap-3">
        <Button onClick={reset}>
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
        <a href="/dashboard">
          <Button variant="outline">Dashboard</Button>
        </a>
      </div>
    </div>
  );
}
