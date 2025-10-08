/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14+ uses App Router by default, but let's be explicit
  // Ensure we're not using any Pages Router features
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
}

module.exports = nextConfig

