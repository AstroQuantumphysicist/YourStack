import type { Blueprint } from '@yourstack/shared';
import { toYaml } from './yaml';

/**
 * Client-side model for the visual infrastructure builder. Nodes carry a
 * canvas position (x/y) plus resource props; edges express relationships that
 * map onto the blueprint (domain → app attaches a hostname; load-balancer → app
 * adds a target). The blueprint (`yourstack.yaml`) is derived from this model
 * and, in reverse, imported blueprints are laid out into a fresh model.
 */

export type NodeKind =
  | 'app'
  | 'database'
  | 'bucket'
  | 'function'
  | 'cron'
  | 'firewall'
  | 'loadBalancer'
  | 'domain';

export interface BuilderRule {
  allow: boolean;
  protocol: string;
  port: string;
  cidr: string;
}

export interface BuilderNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  name: string;
  // app
  source?: string;
  image?: string;
  port?: number;
  framework?: string;
  // database
  engine?: string;
  version?: string;
  // bucket
  isPublic?: boolean;
  quota?: string;
  // function
  runtime?: string;
  handler?: string;
  // cron
  schedule?: string;
  command?: string;
  // firewall
  defaultInbound?: string;
  rules?: BuilderRule[];
  // loadBalancer
  algorithm?: string;
  listenPort?: number;
  targets?: string[];
  domain?: string;
  autoHttps?: boolean;
  // domain
  hostname?: string;
}

export interface BuilderEdge {
  id: string;
  from: string;
  to: string;
}

export interface BuilderState {
  project: string;
  region?: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

export const NODE_META: Record<NodeKind, { label: string; accent: string }> = {
  app: { label: 'App', accent: 'primary' },
  database: { label: 'Database', accent: 'info' },
  bucket: { label: 'Bucket', accent: 'success' },
  function: { label: 'Function', accent: 'warning' },
  cron: { label: 'Cron', accent: 'info' },
  firewall: { label: 'Firewall', accent: 'danger' },
  loadBalancer: { label: 'Load Balancer', accent: 'primary' },
  domain: { label: 'Domain', accent: 'success' },
};

export const NODE_KINDS: NodeKind[] = [
  'app',
  'database',
  'bucket',
  'function',
  'cron',
  'loadBalancer',
  'firewall',
  'domain',
];

let idSeq = 0;
export function builderId(prefix = 'n'): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

function defaultName(kind: NodeKind, existing: BuilderNode[]): string {
  const base = kind === 'loadBalancer' ? 'lb' : kind;
  const count = existing.filter((n) => n.kind === kind).length + 1;
  return `${base}${count}`;
}

/** Create a new node of a kind with sensible defaults. */
export function makeNode(kind: NodeKind, x: number, y: number, existing: BuilderNode[]): BuilderNode {
  const node: BuilderNode = { id: builderId(kind), kind, x, y, name: defaultName(kind, existing) };
  switch (kind) {
    case 'app':
      node.framework = 'node';
      node.port = 3000;
      node.source = '';
      break;
    case 'database':
      node.engine = 'postgres';
      node.version = '16';
      break;
    case 'bucket':
      node.isPublic = false;
      break;
    case 'function':
      node.runtime = 'node20';
      node.handler = 'index.handler';
      break;
    case 'cron':
      node.schedule = '0 * * * *';
      node.image = 'alpine:3';
      node.command = "echo 'hello'";
      break;
    case 'firewall':
      node.defaultInbound = 'deny';
      node.rules = [
        { allow: true, protocol: 'tcp', port: '443', cidr: '0.0.0.0/0' },
      ];
      break;
    case 'loadBalancer':
      node.algorithm = 'round_robin';
      node.listenPort = 80;
      node.autoHttps = true;
      node.targets = [];
      break;
    case 'domain':
      node.hostname = 'example.com';
      node.name = 'example.com';
      break;
  }
  return node;
}

function neighbors(state: BuilderState, id: string): BuilderNode[] {
  const ids = new Set<string>();
  for (const e of state.edges) {
    if (e.from === id) ids.add(e.to);
    if (e.to === id) ids.add(e.from);
  }
  return state.nodes.filter((n) => ids.has(n.id));
}

/** Derive a blueprint object from the builder model. */
export function stateToBlueprint(state: BuilderState): Blueprint {
  const apps = state.nodes
    .filter((n) => n.kind === 'app')
    .map((n) => {
      const domains = neighbors(state, n.id)
        .filter((x) => x.kind === 'domain' && x.hostname)
        .map((x) => x.hostname!);
      return trim({
        name: n.name,
        source: n.source || undefined,
        image: n.image || undefined,
        framework: n.framework || undefined,
        port: n.port,
        domains: domains.length ? domains : undefined,
      });
    });

  const databases = state.nodes
    .filter((n) => n.kind === 'database')
    .map((n) => trim({ name: n.name, engine: n.engine ?? 'postgres', version: n.version || undefined }));

  const buckets = state.nodes
    .filter((n) => n.kind === 'bucket')
    .map((n) => trim({ name: n.name, public: n.isPublic || undefined, quota: n.quota || undefined }));

  const functions = state.nodes
    .filter((n) => n.kind === 'function')
    .map((n) =>
      trim({ name: n.name, runtime: n.runtime ?? 'node20', handler: n.handler || undefined }),
    );

  const cron = state.nodes
    .filter((n) => n.kind === 'cron')
    .map((n) =>
      trim({
        name: n.name,
        schedule: n.schedule ?? '0 * * * *',
        image: n.image ?? 'alpine:3',
        command: n.command || undefined,
      }),
    );

  const firewalls = state.nodes
    .filter((n) => n.kind === 'firewall')
    .map((n) =>
      trim({
        name: n.name,
        defaultInbound: n.defaultInbound ?? 'deny',
        rules: (n.rules ?? []).map((r) =>
          trim({ allow: r.allow, protocol: r.protocol, port: r.port || undefined, cidr: r.cidr }),
        ),
      }),
    );

  const loadBalancers = state.nodes
    .filter((n) => n.kind === 'loadBalancer')
    .map((n) => {
      const appTargets = neighbors(state, n.id)
        .filter((x) => x.kind === 'app')
        .map((x) => x.name);
      const targets = [...appTargets, ...(n.targets ?? [])].filter(Boolean);
      return trim({
        name: n.name,
        port: n.listenPort ?? 80,
        algorithm: n.algorithm || undefined,
        targets: targets.length ? targets : [],
        domain: n.domain || undefined,
        autoHttps: n.autoHttps || undefined,
      });
    });

  return {
    version: 1,
    project: state.project || 'my-project',
    region: state.region || undefined,
    apps,
    databases,
    buckets,
    functions,
    cron,
    firewalls,
    loadBalancers,
  } as Blueprint;
}

/** Strip undefined values so serialized YAML stays clean. */
function trim<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** Produce a clean plain object for YAML display (drops empty arrays). */
function blueprintForYaml(bp: Blueprint): Record<string, unknown> {
  const out: Record<string, unknown> = { version: bp.version ?? 1, project: bp.project };
  if (bp.region) out.region = bp.region;
  const keys: Array<keyof Blueprint> = [
    'apps',
    'databases',
    'buckets',
    'functions',
    'cron',
    'firewalls',
    'loadBalancers',
  ];
  for (const k of keys) {
    const arr = bp[k] as unknown[] | undefined;
    if (arr && arr.length) out[k] = arr;
  }
  return out;
}

export function stateToYaml(state: BuilderState): string {
  return toYaml(blueprintForYaml(stateToBlueprint(state)));
}

/** Column lane per kind for a tidy auto-layout when importing/loading. */
const LANE: Record<NodeKind, number> = {
  domain: 0,
  loadBalancer: 1,
  app: 2,
  function: 2,
  cron: 2,
  database: 3,
  bucket: 3,
  firewall: 3,
};

/** Lay a blueprint out into a fresh builder model with auto-positioning. */
export function blueprintToState(bp: Blueprint): BuilderState {
  const nodes: BuilderNode[] = [];
  const edges: BuilderEdge[] = [];
  const laneCount: Record<number, number> = {};

  const place = (kind: NodeKind): { x: number; y: number } => {
    const lane = LANE[kind];
    const row = laneCount[lane] ?? 0;
    laneCount[lane] = row + 1;
    return { x: 60 + lane * 240, y: 40 + row * 130 };
  };

  const appByName = new Map<string, BuilderNode>();

  for (const a of bp.apps ?? []) {
    const pos = place('app');
    const node: BuilderNode = {
      id: builderId('app'),
      kind: 'app',
      ...pos,
      name: a.name,
      source: a.source ?? '',
      image: a.image ?? '',
      framework: a.framework,
      port: a.port,
    };
    nodes.push(node);
    appByName.set(a.name, node);
    for (const host of a.domains ?? []) {
      const dpos = place('domain');
      const dnode: BuilderNode = {
        id: builderId('domain'),
        kind: 'domain',
        ...dpos,
        name: host,
        hostname: host,
      };
      nodes.push(dnode);
      edges.push({ id: builderId('e'), from: dnode.id, to: node.id });
    }
  }

  for (const d of bp.databases ?? []) {
    nodes.push({
      id: builderId('database'),
      kind: 'database',
      ...place('database'),
      name: d.name,
      engine: d.engine,
      version: d.version,
    });
  }
  for (const b of bp.buckets ?? []) {
    nodes.push({
      id: builderId('bucket'),
      kind: 'bucket',
      ...place('bucket'),
      name: b.name,
      isPublic: b.public,
      quota: b.quota != null ? String(b.quota) : undefined,
    });
  }
  for (const f of bp.functions ?? []) {
    nodes.push({
      id: builderId('function'),
      kind: 'function',
      ...place('function'),
      name: f.name,
      runtime: f.runtime,
      handler: f.handler,
    });
  }
  for (const c of bp.cron ?? []) {
    nodes.push({
      id: builderId('cron'),
      kind: 'cron',
      ...place('cron'),
      name: c.name,
      schedule: c.schedule,
      image: c.image,
      command: c.command,
    });
  }
  for (const fw of bp.firewalls ?? []) {
    nodes.push({
      id: builderId('firewall'),
      kind: 'firewall',
      ...place('firewall'),
      name: fw.name,
      defaultInbound: fw.defaultInbound,
      rules: (fw.rules ?? []).map((r) => ({
        allow: r.allow ?? true,
        protocol: r.protocol ?? 'tcp',
        port: r.port ?? '',
        cidr: r.cidr ?? '0.0.0.0/0',
      })),
    });
  }
  for (const lb of bp.loadBalancers ?? []) {
    const pos = place('loadBalancer');
    const node: BuilderNode = {
      id: builderId('loadBalancer'),
      kind: 'loadBalancer',
      ...pos,
      name: lb.name,
      listenPort: lb.port,
      algorithm: lb.algorithm,
      domain: lb.domain,
      autoHttps: lb.autoHttps,
      targets: [],
    };
    const manual: string[] = [];
    for (const t of lb.targets ?? []) {
      const app = appByName.get(t);
      if (app) edges.push({ id: builderId('e'), from: node.id, to: app.id });
      else manual.push(t);
    }
    node.targets = manual;
    nodes.push(node);
  }

  return { project: bp.project, region: bp.region, nodes, edges };
}
