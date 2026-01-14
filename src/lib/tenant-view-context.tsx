'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

type ViewMode = 'user' | 'admin'

interface TenantViewContextType {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

const TenantViewContext = createContext<TenantViewContextType | undefined>(undefined)

export function TenantViewProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>('user')

  return (
    <TenantViewContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </TenantViewContext.Provider>
  )
}

export function useTenantView() {
  const context = useContext(TenantViewContext)
  if (context === undefined) {
    throw new Error('useTenantView must be used within a TenantViewProvider')
  }
  return context
}

