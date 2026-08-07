/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use dist directory for build output to avoid caching issues.
  // NEXT_DIST_DIR lets a deploy build into a staging directory (dist-new) while
  // the live server keeps serving `dist`, so the outage is the restart, not the
  // whole build. See scripts/deploy.sh. Never set this in .env — `next start`
  // reads this config too and would then serve the staging directory.
  distDir: process.env.NEXT_DIST_DIR || 'dist',

  // Minimal config for development
  experimental: {
    webpackBuildWorker: false,
    optimizeCss: true, // Optimize CSS loading and preloading
    outputFileTracingIncludes: {
      '/api/novelty-search/[searchId]/attorney-report/pdf': ['./src/fonts/inter/*.ttf'],
    },
  },

  // Webpack configuration to handle offline scenarios
  webpack: (config, { dev }) => {
    // Exclude problematic libraries from bundling
    config.externals = config.externals || []
    config.externals.push({
      'pdf2text': 'pdf2text',
      'canvas': 'canvas',
    })

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
