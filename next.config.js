/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14+ uses App Router by default, but let's be explicit
  // Ensure we're not using any Pages Router features
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],

  // Configure experimental features for better offline support
  experimental: {
    // Disable webpack build worker for offline development
    webpackBuildWorker: false,
  },

  // Configure headers to prevent external requests during development
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ]
  },

  // Webpack configuration to handle offline scenarios
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable external version checking in development
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      }
    }
    return config
  },
}

module.exports = nextConfig

