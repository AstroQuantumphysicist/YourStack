import { YourStackClient } from './client.js';
import { startMcpServer } from './server.js';

/**
 * Standalone `yourstack-mcp` binary. Reads YOURSTACK_TOKEN + YOURSTACK_API_URL
 * from the environment. (The `yst mcp` CLI command runs the same server from
 * your saved login instead.)
 */
startMcpServer(YourStackClient.fromEnv()).catch((err) => {
  process.stderr.write(`Failed to start YourStack MCP server: ${err}\n`);
  process.exit(1);
});
