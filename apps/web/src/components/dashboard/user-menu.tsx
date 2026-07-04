'use client';

import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui/avatar';
import {
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from '@/components/ui/dropdown';

export function UserMenu() {
  const { user, logout } = useSession();
  if (!user) return null;

  return (
    <Dropdown
      trigger={
        <span className="inline-flex items-center rounded-full outline-none ring-offset-background transition-shadow hover:ring-2 hover:ring-ring/40">
          <Avatar src={user.avatarUrl} name={user.name} email={user.email} size={34} />
        </span>
      }
      menuClassName="w-60"
    >
      {(close) => (
        <>
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar src={user.avatarUrl} name={user.name} email={user.email} size={34} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {user.name ?? user.email}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          {user.isPlatformAdmin ? (
            <>
              <DropdownSeparator />
              <DropdownLabel>Platform</DropdownLabel>
              <Link href="/dashboard/admin" onClick={close}>
                <DropdownItem>
                  <ShieldCheck className="h-4 w-4" /> Admin console
                </DropdownItem>
              </Link>
            </>
          ) : null}
          <DropdownSeparator />
          <Link href="/dashboard/settings" onClick={close}>
            <DropdownItem>
              <UserIcon className="h-4 w-4" /> Workspace settings
            </DropdownItem>
          </Link>
          <DropdownItem
            destructive
            onClick={() => {
              close();
              void logout();
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
