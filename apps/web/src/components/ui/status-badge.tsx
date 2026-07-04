import {
  AppStatus,
  BucketStatus,
  CronJobStatus,
  DatabaseStatus,
  DeploymentStatus,
  DomainStatus,
  FirewallStatus,
  FunctionStatus,
  LoadBalancerStatus,
  NodeStatus,
  PipelineRunStatus,
  RunnerStatus,
} from '@yourstack/shared';
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
  [AppStatus.UNREACHABLE]: 'warning',
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

const databaseMap: Record<string, Variant> = {
  [DatabaseStatus.RUNNING]: 'success',
  [DatabaseStatus.PROVISIONING]: 'info',
  [DatabaseStatus.BACKING_UP]: 'info',
  [DatabaseStatus.STOPPED]: 'default',
  [DatabaseStatus.FAILED]: 'danger',
};

const bucketMap: Record<string, Variant> = {
  [BucketStatus.ACTIVE]: 'success',
  [BucketStatus.PROVISIONING]: 'info',
  [BucketStatus.FAILED]: 'danger',
};

const functionMap: Record<string, Variant> = {
  [FunctionStatus.ACTIVE]: 'success',
  [FunctionStatus.DEPLOYING]: 'info',
  [FunctionStatus.IDLE]: 'default',
  [FunctionStatus.FAILED]: 'danger',
};

const runnerMap: Record<string, Variant> = {
  [RunnerStatus.IDLE]: 'success',
  [RunnerStatus.BUSY]: 'info',
  [RunnerStatus.REGISTERING]: 'info',
  [RunnerStatus.OFFLINE]: 'default',
};

const cronMap: Record<string, Variant> = {
  [CronJobStatus.ACTIVE]: 'success',
  [CronJobStatus.RUNNING]: 'info',
  [CronJobStatus.PAUSED]: 'default',
  [CronJobStatus.FAILED]: 'danger',
  // Cron *run* statuses (shared between job + run rendering). 'running' and
  // 'failed' already map above via CronJobStatus.
  success: 'success',
  succeeded: 'success',
  queued: 'default',
  timed_out: 'warning',
  canceled: 'warning',
};

const firewallMap: Record<string, Variant> = {
  [FirewallStatus.ACTIVE]: 'success',
  [FirewallStatus.APPLYING]: 'info',
  [FirewallStatus.DRAFT]: 'default',
  [FirewallStatus.FAILED]: 'danger',
};

const loadBalancerMap: Record<string, Variant> = {
  [LoadBalancerStatus.ACTIVE]: 'success',
  [LoadBalancerStatus.PROVISIONING]: 'info',
  [LoadBalancerStatus.DEGRADED]: 'warning',
  [LoadBalancerStatus.FAILED]: 'danger',
};

const kinds = {
  app: appMap,
  node: nodeMap,
  deployment: deployMap,
  pipeline: pipelineMap,
  domain: domainMap,
  database: databaseMap,
  bucket: bucketMap,
  function: functionMap,
  runner: runnerMap,
  cron: cronMap,
  firewall: firewallMap,
  loadBalancer: loadBalancerMap,
} as const;

const activeStates = new Set<string>([
  AppStatus.BUILDING,
  AppStatus.DEPLOYING,
  DeploymentStatus.BUILDING,
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.QUEUED,
  PipelineRunStatus.RUNNING,
  DomainStatus.VERIFYING,
  DatabaseStatus.PROVISIONING,
  DatabaseStatus.BACKING_UP,
  BucketStatus.PROVISIONING,
  FunctionStatus.DEPLOYING,
  RunnerStatus.BUSY,
  RunnerStatus.REGISTERING,
  CronJobStatus.RUNNING,
  FirewallStatus.APPLYING,
  LoadBalancerStatus.PROVISIONING,
  'running',
  'queued',
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
  const pulsing = activeStates.has(status);
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
