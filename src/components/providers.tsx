'use client'

import { AuthProvider } from '@/lib/auth-context'
import { TenantViewProvider } from '@/lib/tenant-view-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TenantViewProvider>
        {children}
      </TenantViewProvider>
    </AuthProvider>
  )
}

// Note: Next.js 13+ automatically provides navigation context
// No need to manually add NavigationProvider

