'use client'

// Renders the global site Header everywhere except immersive landing routes that
// supply their own navigation (e.g. /patentnest). Kept as a thin client wrapper
// so the server root layout doesn't need to read the pathname, and so Header's
// own hook usage stays stable across route changes.

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'

// '/' matches exactly (the startsWith check adds a trailing slash, so only the
// root itself is headerless); the PatentNest landing page is now the default
// homepage and brings its own nav. The classic homepage at /classic-home keeps
// the global Header, as it always had. /blog renders the same PatentNestNav
// from its own layout, so it opts out here too.
const HEADERLESS_ROUTES = ['/', '/patentnest', '/blog']

export default function ConditionalHeader() {
  const pathname = usePathname()
  if (pathname && HEADERLESS_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return null
  }
  return <Header />
}
