'use client'

import { AuthProvider } from '@/lib/auth-context'
import { TenantViewProvider } from '@/lib/tenant-view-context'
import { ToastProvider } from '@/components/ui/toast'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TenantViewProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </TenantViewProvider>
    </AuthProvider>
  )
}

// Note: Next.js 13+ automatically provides navigation context
// No need to manually add NavigationProvider

