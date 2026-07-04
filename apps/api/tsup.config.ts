import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace packages (consumed as source) into the output
  // so the production image needs no workspace symlinks. Keep native/heavy deps
  // external.
  noExternal: [/@noderail\//],
  external: ['@prisma/client', '.prisma/client'],
});
