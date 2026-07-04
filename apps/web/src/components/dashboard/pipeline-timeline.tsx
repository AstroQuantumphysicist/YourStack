import { Check, Circle, Loader2, Minus, X } from 'lucide-react';
import type { PipelineRunDTO } from '@yourstack/shared';
import { StageStatus } from '@yourstack/shared';
import { cn } from '@/lib/utils';

const stageIcon = {
  [StageStatus.SUCCEEDED]: { Icon: Check, cls: 'text-success border-success/40 bg-success/10' },
  [StageStatus.RUNNING]: { Icon: Loader2, cls: 'text-info border-info/40 bg-info/10 animate-spin' },
  [StageStatus.FAILED]: { Icon: X, cls: 'text-danger border-danger/40 bg-danger/10' },
  [StageStatus.SKIPPED]: { Icon: Minus, cls: 'text-muted-foreground border-border bg-surface-muted' },
  [StageStatus.PENDING]: { Icon: Circle, cls: 'text-muted-foreground border-border bg-surface-muted' },
} as const;

export function PipelineTimeline({ run }: { run: PipelineRunDTO }) {
  return (
    <ol className="space-y-1">
      {run.stages.map((stage, i) => {
        const meta = stageIcon[stage.status] ?? stageIcon[StageStatus.PENDING];
        const Icon = meta.Icon;
        const duration =
          stage.startedAt && stage.finishedAt
            ? `${Math.max(0, Math.round((new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime()) / 1000))}s`
            : null;
        return (
          <li key={`${stage.name}-${i}`} className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                meta.cls,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-1 items-center justify-between border-b border-border/60 py-2">
              <span className="text-sm capitalize text-foreground">{stage.name}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {stage.exitCode != null && stage.exitCode !== 0 ? (
                  <span className="text-danger">exit {stage.exitCode}</span>
                ) : null}
                {duration ? <span>{duration}</span> : null}
                <span className="capitalize">{stage.status}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
