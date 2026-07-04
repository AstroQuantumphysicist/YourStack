import type { AuditLogDTO } from '@noderail/shared';
import { Activity } from 'lucide-react';
import { timeAgo } from '@/lib/format';
import { EmptyState } from '@/components/ui/states';

function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ActivityFeed({ logs }: { logs: AuditLogDTO[] }) {
  if (!logs.length) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Actions across your workspace — deploys, member changes, node joins — will appear here."
      />
    );
  }

  return (
    <ul className="space-y-1">
      {logs.map((log) => (
        <li
          key={log.id}
          className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-muted/60"
        >
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/70" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">
              <span className="font-medium">{humanizeAction(log.action)}</span>
              {log.targetType ? (
                <span className="text-muted-foreground"> · {log.targetType}</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {log.actorEmail ?? 'system'} · {timeAgo(log.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
