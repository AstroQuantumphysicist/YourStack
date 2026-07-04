import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace packages (consumed as source) into the output
  // so the published CLI needs no workspace symlinks. Third-party deps stay
  // external and are resolved from node_modules at runtime.
  noExternal: [/@noderail\//],
  // Preserve the shebang so `noderail` is directly executable.
  banner: { js: '#!/usr/bin/env node' },
});
