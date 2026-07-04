import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { YourStackClient } from './client.js';

/**
 * YourStack MCP server — connect any AI agent (Claude Desktop, Cursor, your own
 * agent) to YourStack so it can deploy apps, provision databases/storage/
 * functions, run the marketplace, inspect logs + metrics, and manage nodes.
 *
 * Auth: set YOURSTACK_TOKEN (a `ys_…` personal API token from the dashboard) and
 * optionally YOURSTACK_API_URL. Runs over stdio.
 */
const client = YourStackClient.fromEnv();
const server = new McpServer({ name: 'yourstack', version: '0.1.0' });

/** Register a tool that returns JSON text. */
function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
): void {
  const cb = async (args: z.infer<z.ZodObject<S>>) => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  };
  // The SDK's `.tool` has 6 overloads and an over-constrained callback return
  // union; our text-only content is valid at runtime. Bridge the boundary with a
  // single loose cast rather than fighting overload resolution.
  type RegisterTool = (n: string, d: string, s: S, c: typeof cb) => void;
  (server.tool as unknown as RegisterTool)(name, description, schema, cb);
}

/* --------------------------------- Identity --------------------------------- */

tool('whoami', 'Get the authenticated user and their workspaces.', {}, () => client.get('/auth/me'));

tool(
  'list_projects',
  'List projects in a workspace.',
  { workspaceId: z.string().describe('Workspace id') },
  ({ workspaceId }) => client.get(`/workspaces/${workspaceId}/projects`),
);

tool(
  'workspace_stats',
  'Get counts of apps, nodes, databases, functions, etc. for a workspace.',
  { workspaceId: z.string() },
  ({ workspaceId }) => client.get(`/workspaces/${workspaceId}/stats`),
);

/* ----------------------------------- Apps ----------------------------------- */

tool('list_apps', 'List apps in a project.', { projectId: z.string() }, ({ projectId }) =>
  client.get(`/projects/${projectId}/apps`),
);

tool(
  'create_app',
  'Create an app in a project. Provide a git repoUrl to deploy from GitHub, or a bare image ref (e.g. "nginx:1.27") to run a container.',
  {
    projectId: z.string(),
    name: z.string(),
    repoUrl: z.string().optional().describe('git URL or a container image ref'),
    branch: z.string().optional(),
    framework: z.enum(['nextjs', 'node', 'python', 'dockerfile', 'static']).optional(),
    port: z.number().int().optional(),
    nodeId: z.string().optional(),
  },
  (a) => client.post(`/projects/${a.projectId}/apps`, a),
);

tool('get_app', 'Get an app by id.', { appId: z.string() }, ({ appId }) => client.get(`/apps/${appId}`));

tool(
  'deploy_app',
  'Trigger a deployment of an app. Returns the deployment id + version.',
  { appId: z.string(), ref: z.string().optional(), reason: z.string().optional() },
  ({ appId, ref, reason }) => client.post(`/apps/${appId}/deploy`, { ref, reason }),
);

tool('stop_app', 'Stop a running app.', { appId: z.string() }, ({ appId }) => client.post(`/apps/${appId}/stop`));
tool('restart_app', 'Restart an app.', { appId: z.string() }, ({ appId }) => client.post(`/apps/${appId}/restart`));
tool(
  'rollback_app',
  'Roll an app back to a previous deployment.',
  { appId: z.string(), targetDeploymentId: z.string() },
  ({ appId, targetDeploymentId }) => client.post(`/apps/${appId}/rollback`, { targetDeploymentId }),
);

tool('list_deployments', 'List an app’s deployments.', { appId: z.string() }, ({ appId }) =>
  client.get(`/apps/${appId}/deployments`),
);
tool('get_deployment', 'Get a deployment + its pipeline run.', { deploymentId: z.string() }, ({ deploymentId }) =>
  client.get(`/deployments/${deploymentId}`),
);
tool(
  'get_app_logs',
  'Get recent runtime logs for an app.',
  { appId: z.string(), search: z.string().optional(), limit: z.number().int().optional() },
  (a) => client.get(`/apps/${a.appId}/logs?limit=${a.limit ?? 200}${a.search ? `&search=${encodeURIComponent(a.search)}` : ''}`),
);

/* -------------------------------- Env / secrets ----------------------------- */

tool(
  'set_secret',
  'Set an app-scoped secret (environment variable). Values are encrypted at rest.',
  { appId: z.string(), key: z.string(), value: z.string() },
  ({ appId, key, value }) => client.post('/secrets', { scope: 'app', appId, key, value }),
);

/* ------------------------------ Managed resources --------------------------- */

tool(
  'create_database',
  'Provision a managed database (Postgres/MySQL/Redis/MongoDB) on a node.',
  {
    projectId: z.string(),
    name: z.string(),
    engine: z.enum(['postgres', 'mysql', 'redis', 'mongodb']),
    version: z.string().optional(),
    storageMb: z.number().int().optional(),
    cpu: z.number().optional(),
    memoryMb: z.number().int().optional(),
    region: z.string().optional(),
  },
  (a) => client.post(`/projects/${a.projectId}/databases`, a),
);
tool('list_databases', 'List databases in a project.', { projectId: z.string() }, ({ projectId }) =>
  client.get(`/projects/${projectId}/databases`),
);
tool(
  'create_bucket',
  'Provision an S3-compatible object-storage bucket.',
  { projectId: z.string(), name: z.string(), isPublic: z.boolean().optional(), quotaMb: z.number().int().optional() },
  (a) => client.post(`/projects/${a.projectId}/buckets`, a),
);
tool(
  'create_function',
  'Deploy a serverless function (node20/python311/go122/bun1).',
  {
    projectId: z.string(),
    name: z.string(),
    runtime: z.enum(['node20', 'python311', 'go122', 'bun1']),
    handler: z.string().optional(),
    repoUrl: z.string().optional(),
    memoryMb: z.number().int().optional(),
  },
  (a) => client.post(`/projects/${a.projectId}/functions`, a),
);
tool(
  'invoke_function',
  'Invoke a serverless function with a JSON payload.',
  { functionId: z.string(), payload: z.record(z.string(), z.unknown()).optional() },
  ({ functionId, payload }) => client.post(`/functions/${functionId}/invoke`, { payload: payload ?? {} }),
);

/* ------------------------------- Marketplace -------------------------------- */

tool(
  'list_templates',
  'Browse the YourStack marketplace of one-click deployable software (databases, CMS, automation, AI, monitoring…).',
  { category: z.string().optional(), search: z.string().optional() },
  (a) => {
    const q = new URLSearchParams();
    if (a.category) q.set('category', a.category);
    if (a.search) q.set('search', a.search);
    return client.get(`/templates${q.toString() ? `?${q}` : ''}`);
  },
);
tool(
  'deploy_template',
  'Deploy a marketplace template (by slug) into a project — one-click host anything.',
  {
    templateSlug: z.string(),
    projectId: z.string(),
    name: z.string().optional(),
    region: z.string().optional(),
    variables: z.record(z.string(), z.string()).optional(),
  },
  (a) => client.post('/templates/deploy', { ...a, variables: a.variables ?? {} }),
);

/* ---------------------------------- Cron ------------------------------------ */

tool(
  'create_cron_job',
  'Schedule a container to run on a cron schedule.',
  {
    projectId: z.string(),
    name: z.string(),
    schedule: z.string().describe('5-field cron expression, e.g. "0 3 * * *"'),
    image: z.string(),
    command: z.string().optional(),
  },
  (a) => client.post(`/projects/${a.projectId}/cron`, a),
);
tool('list_cron_jobs', 'List cron jobs in a project.', { projectId: z.string() }, ({ projectId }) =>
  client.get(`/projects/${projectId}/cron`),
);

/* --------------------------------- Metrics ---------------------------------- */

tool(
  'get_metrics',
  'Query time-series metrics (cpu_percent, mem_mb, rps, latency_ms, …) for an app/node/database/function.',
  {
    scope: z.enum(['app', 'node', 'database', 'function']),
    targetId: z.string(),
    kinds: z.string().optional().describe('comma-separated metric kinds'),
    windowSeconds: z.number().int().optional(),
  },
  (a) => {
    const q = new URLSearchParams({ scope: a.scope, targetId: a.targetId, windowSeconds: String(a.windowSeconds ?? 3600) });
    if (a.kinds) q.set('kinds', a.kinds);
    return client.get(`/metrics?${q}`);
  },
);

/* ---------------------------------- Nodes ----------------------------------- */

tool('list_nodes', 'List nodes in a workspace.', { workspaceId: z.string() }, ({ workspaceId }) =>
  client.get(`/workspaces/${workspaceId}/nodes`),
);
tool(
  'create_node_join_token',
  'Mint a one-time token + install command to connect a new server as a node.',
  { workspaceId: z.string(), region: z.string().optional(), label: z.string().optional() },
  (a) => client.post(`/workspaces/${a.workspaceId}/nodes/join-token`, a),
);
tool('list_regions', 'List available regions.', {}, () => client.get('/regions'));

/* ---------------------------------- Boot ------------------------------------ */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP protocol channel.
  process.stderr.write('YourStack MCP server ready (stdio).\n');
}

main().catch((err) => {
  process.stderr.write(`Failed to start YourStack MCP server: ${err}\n`);
  process.exit(1);
});
