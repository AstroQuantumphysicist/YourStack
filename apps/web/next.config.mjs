/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the internal package as source (its main points at ./src/index.ts).
  transpilePackages: ['@noderail/shared'],
  // Emit a self-contained server bundle for Docker.
  output: 'standalone',
  eslint: {
    // Linting is handled by the monorepo's shared flat ESLint config via the
    // `lint` script (`eslint .`), not by `next build`, so the web app stays on
    // the same ESLint 9 toolchain as every other package.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: '**.githubusercontent.com' },
    ],
  },
  webpack: (config) => {
    // @noderail/shared is consumed as TypeScript source and uses ESM-style
    // `.js` import specifiers that actually point at `.ts` files. Teach
    // webpack to resolve `.js` → `.ts`/`.tsx` so those imports resolve.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
