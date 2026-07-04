import Link from 'next/link';
import { Home, Compass } from 'lucide-react';
import { Wordmark } from '@/components/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="app-aurora flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Wordmark />
      <div className="mt-10 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-muted text-primary">
        <Compass className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-5xl font-semibold tracking-tight text-gradient">404</h1>
      <p className="mt-3 max-w-sm text-muted-foreground">
        This route derailed. The page you&apos;re looking for doesn&apos;t exist or was moved.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/dashboard">
          <Button>
            <Home className="h-4 w-4" /> Back to dashboard
          </Button>
        </Link>
        <Link href="/">
          <Button variant="outline">Home</Button>
        </Link>
      </div>
    </div>
  );
}
