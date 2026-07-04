import {
  AppStatus,
  DeploymentStatus,
  DomainStatus,
  NodeStatus,
  PipelineRunStatus,
} from '@noderail/shared';
import { Badge, type BadgeProps } from './badge';
import { cn } from '@/lib/utils';

type Variant = NonNullable<BadgeProps['variant']>;

const appMap: Record<string, Variant> = {
  [AppStatus.RUNNING]: 'success',
  [AppStatus.BUILDING]: 'info',
  [AppStatus.DEPLOYING]: 'info',
  [AppStatus.IDLE]: 'default',
  [AppStatus.STOPPED]: 'default',
  [AppStatus.FAILED]: 'danger',
};

const nodeMap: Record<string, Variant> = {
  [NodeStatus.ONLINE]: 'success',
  [NodeStatus.DEGRADED]: 'warning',
  [NodeStatus.OFFLINE]: 'danger',
  [NodeStatus.DRAINING]: 'warning',
};

const deployMap: Record<string, Variant> = {
  [DeploymentStatus.RUNNING]: 'success',
  [DeploymentStatus.QUEUED]: 'default',
  [DeploymentStatus.BUILDING]: 'info',
  [DeploymentStatus.DEPLOYING]: 'info',
  [DeploymentStatus.FAILED]: 'danger',
  [DeploymentStatus.STOPPED]: 'default',
  [DeploymentStatus.ROLLED_BACK]: 'warning',
  [DeploymentStatus.SUPERSEDED]: 'default',
};

const pipelineMap: Record<string, Variant> = {
  [PipelineRunStatus.SUCCEEDED]: 'success',
  [PipelineRunStatus.RUNNING]: 'info',
  [PipelineRunStatus.QUEUED]: 'default',
  [PipelineRunStatus.FAILED]: 'danger',
  [PipelineRunStatus.CANCELED]: 'warning',
};

const domainMap: Record<string, Variant> = {
  [DomainStatus.ACTIVE]: 'success',
  [DomainStatus.VERIFIED]: 'success',
  [DomainStatus.VERIFYING]: 'info',
  [DomainStatus.PENDING]: 'warning',
  [DomainStatus.FAILED]: 'danger',
};

const kinds = {
  app: appMap,
  node: nodeMap,
  deployment: deployMap,
  pipeline: pipelineMap,
  domain: domainMap,
} as const;

const activeStates = new Set([
  AppStatus.BUILDING,
  AppStatus.DEPLOYING,
  DeploymentStatus.BUILDING,
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.QUEUED,
  PipelineRunStatus.RUNNING,
  DomainStatus.VERIFYING,
]);

export function StatusBadge({
  kind,
  status,
  className,
}: {
  kind: keyof typeof kinds;
  status: string;
  className?: string;
}) {
  const variant = kinds[kind][status] ?? 'default';
  const pulsing = activeStates.has(status as never);
  return (
    <Badge variant={variant} className={cn('capitalize', className)}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current',
          pulsing && 'animate-pulse-dot',
        )}
      />
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
