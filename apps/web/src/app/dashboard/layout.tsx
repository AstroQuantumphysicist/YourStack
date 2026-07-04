'use client';

import { SessionProvider } from '@/lib/session';
import { OrgProvider } from '@/lib/org';
import { DashboardShell } from '@/components/dashboard/shell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider requireAuth>
      <OrgProvider>
        <DashboardShell>{children}</DashboardShell>
      </OrgProvider>
    </SessionProvider>
  );
}
