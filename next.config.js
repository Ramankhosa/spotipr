/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use dist directory for build output to avoid caching issues
  distDir: 'dist',

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
