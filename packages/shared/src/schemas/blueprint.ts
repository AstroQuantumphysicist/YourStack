import { z } from 'zod';

/**
 * `yourstack.yaml` — declarative definition of an entire project's cloud setup.
 * The visual builder reads/writes this; `yst apply` and the API's blueprint
 * engine reconcile it into real resources (apps, databases, storage, functions,
 * cron, firewalls, load balancers, domains).
 */

const resourcesSchema = z
  .object({ cpu: z.number().positive().optional(), memory: z.union([z.number(), z.string()]).optional() })
  .optional();

export const blueprintAppSchema = z.object({
  name: z.string().min(1),
  /** git repo URL, or a bare container image (e.g. "nginx:1.27"). */
  source: z.string().optional(),
  image: z.string().optional(),
  branch: z.string().optional(),
  framework: z.enum(['nextjs', 'node', 'python', 'dockerfile', 'static']).optional(),
  build: z.string().optional(),
  start: z.string().optional(),
  port: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  resources: resourcesSchema,
  region: z.string().optional(),
  domains: z.array(z.string()).optional(),
  scaling: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().positive(),
      metric: z.enum(['cpu', 'memory', 'rps', 'latency']).default('cpu'),
      target: z.number().positive(),
    })
    .optional(),
});

export const blueprintDatabaseSchema = z.object({
  name: z.string().min(1),
  engine: z.enum(['postgres', 'mysql', 'redis', 'mongodb']),
  version: z.string().optional(),
  storage: z.union([z.number(), z.string()]).optional(),
  resources: resourcesSchema,
  region: z.string().optional(),
});

export const blueprintBucketSchema = z.object({
  name: z.string().min(1),
  public: z.boolean().optional(),
  quota: z.union([z.number(), z.string()]).optional(),
  region: z.string().optional(),
});

export const blueprintFunctionSchema = z.object({
  name: z.string().min(1),
  runtime: z.enum(['node20', 'python311', 'go122', 'bun1']),
  handler: z.string().optional(),
  source: z.string().optional(),
  memory: z.union([z.number(), z.string()]).optional(),
});

export const blueprintCronSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  image: z.string().min(1),
  command: z.string().optional(),
});

export const blueprintFirewallSchema = z.object({
  name: z.string().min(1),
  nodes: z.array(z.string()).optional(),
  defaultInbound: z.enum(['allow', 'deny']).default('deny'),
  rules: z.array(
    z.object({
      allow: z.boolean().default(true),
      protocol: z.enum(['tcp', 'udp', 'icmp', 'any']).default('tcp'),
      port: z.string().optional(),
      cidr: z.string().default('0.0.0.0/0'),
    }),
  ),
});

export const blueprintLoadBalancerSchema = z.object({
  name: z.string().min(1),
  port: z.number().int().positive(),
  algorithm: z.enum(['round_robin', 'least_conn', 'ip_hash']).optional(),
  /** App names (in this blueprint) or explicit addresses to balance across. */
  targets: z.array(z.string()).min(1),
  domain: z.string().optional(),
  autoHttps: z.boolean().optional(),
});

export const blueprintSchema = z.object({
  version: z.literal(1).default(1),
  project: z.string().min(1),
  region: z.string().optional(),
  apps: z.array(blueprintAppSchema).default([]),
  databases: z.array(blueprintDatabaseSchema).default([]),
  buckets: z.array(blueprintBucketSchema).default([]),
  functions: z.array(blueprintFunctionSchema).default([]),
  cron: z.array(blueprintCronSchema).default([]),
  firewalls: z.array(blueprintFirewallSchema).default([]),
  loadBalancers: z.array(blueprintLoadBalancerSchema).default([]),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

export interface BlueprintParseResult {
  ok: boolean;
  blueprint?: Blueprint;
  errors?: string[];
}

/** Validate an already-parsed YAML/JSON object as a blueprint. */
export function validateBlueprint(raw: unknown): BlueprintParseResult {
  const result = blueprintSchema.safeParse(raw);
  if (result.success) return { ok: true, blueprint: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** A dry-run diff entry produced when reconciling a blueprint. */
export interface BlueprintPlanItem {
  kind: 'app' | 'database' | 'bucket' | 'function' | 'cron' | 'firewall' | 'loadBalancer';
  name: string;
  action: 'create' | 'update' | 'noop';
}
