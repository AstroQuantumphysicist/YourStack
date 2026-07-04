import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace packages (consumed as source) plus the MCP SDK
  // (so `yst mcp` works from a globally-installed, self-contained binary).
  noExternal: [/@yourstack\//, '@modelcontextprotocol/sdk'],
  // Preserve the shebang so `yourstack` is directly executable.
  banner: { js: '#!/usr/bin/env node' },
});
