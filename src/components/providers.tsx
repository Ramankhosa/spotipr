'use client'

import { AuthProvider } from '@/lib/auth-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  )
}

// Note: Next.js 13+ automatically provides navigation context
// No need to manually add NavigationProvider

