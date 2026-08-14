'use client'

// Renders the global site Header everywhere except immersive landing routes that
// supply their own navigation (e.g. /patentnest). Kept as a thin client wrapper
// so the server root layout doesn't need to read the pathname, and so Header's
// own hook usage stays stable across route changes.

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'

// '/' matches exactly (the startsWith check adds a trailing slash, so only the
// root itself is headerless); the homepage is the workspace-style landing page
// and brings its own WorkspaceNav. The document-style landing page at
// /patentnest brings PatentNestNav. The classic homepage at /classic-home keeps
// the global Header, as it always had. /blog renders PatentNestNav from its own
// layout, so it opts out here too. (/home-v2 needs no entry — it redirects to
// '/'.)
// /features/* pages render WorkspaceNav themselves, same as the homepage.
const HEADERLESS_ROUTES = ['/', '/patentnest', '/blog', '/features', '/developers']

export default function ConditionalHeader() {
  const pathname = usePathname()
  if (pathname && HEADERLESS_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return null
  }
  return <Header />
}
