# @yourstack/mcp

An [MCP](https://modelcontextprotocol.io) server that connects any AI agent —
Claude Desktop, Cursor, Claude Code, or your own — to **YourStack**, so it can
deploy apps, provision databases / storage / functions, browse and deploy the
marketplace, schedule cron jobs, inspect logs + metrics, and manage nodes.

## Setup

1. Create a personal API token in the YourStack dashboard (Settings → API tokens).
2. Configure your MCP client. Example (Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "yourstack": {
      "command": "yourstack-mcp",
      "env": {
        "YOURSTACK_API_URL": "https://api.your-yourstack.com",
        "YOURSTACK_TOKEN": "ys_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Run locally with `pnpm --filter @yourstack/mcp build && node apps/mcp/dist/index.js`,
or `YOURSTACK_TOKEN=… pnpm --filter @yourstack/mcp dev`.

## Tools

Identity: `whoami`, `list_projects`, `workspace_stats` · Apps: `list_apps`,
`create_app`, `get_app`, `deploy_app`, `stop_app`, `restart_app`,
`rollback_app`, `list_deployments`, `get_deployment`, `get_app_logs`,
`set_secret` · Managed resources: `create_database`, `list_databases`,
`create_bucket`, `create_function`, `invoke_function` · Marketplace:
`list_templates`, `deploy_template` · Cron: `create_cron_job`,
`list_cron_jobs` · Observability: `get_metrics` · Nodes: `list_nodes`,
`create_node_join_token`, `list_regions`.

The server talks to the same REST API + RBAC as the dashboard — the agent can
only do what the token's user is allowed to do.
