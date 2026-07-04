/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the internal package as source (its main points at ./src/index.ts).
  transpilePackages: ['@noderail/shared'],
  // Emit a self-contained server bundle for Docker.
  output: 'standalone',
  eslint: {
    // Lint runs during `next build`; keep it on but do not fail the build on
    // stylistic issues (rules are relaxed in .eslintrc.json).
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: '**.githubusercontent.com' },
    ],
  },
};

export default nextConfig;
