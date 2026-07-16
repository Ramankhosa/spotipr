'use client'

// Renders the global site Header everywhere except immersive landing routes that
// supply their own navigation (e.g. /patentnest). Kept as a thin client wrapper
// so the server root layout doesn't need to read the pathname, and so Header's
// own hook usage stays stable across route changes.

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'

const HEADERLESS_ROUTES = ['/patentnest']

export default function ConditionalHeader() {
  const pathname = usePathname()
  if (pathname && HEADERLESS_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return null
  }
  return <Header />
}
