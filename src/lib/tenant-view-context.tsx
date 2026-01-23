'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type ViewMode = 'user' | 'admin'

interface TenantViewContextType {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

const TenantViewContext = createContext<TenantViewContextType | undefined>(undefined)

const STORAGE_KEY = 'tenant_view_mode'

export function TenantViewProvider({ children }: { children: ReactNode }) {
  // Initialize with default value to avoid blocking render
  const [viewMode, setViewModeState] = useState<ViewMode>('user')

  // Sync with localStorage on mount (client-side only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'admin' || stored === 'user') {
        setViewModeState(stored)
      }
    } catch (e) {
      // localStorage not available (private browsing, SSR, etc.)
      console.warn('localStorage not available for tenant view mode')
    }
  }, [])

  // Persist to localStorage when viewMode changes
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode)
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch (e) {
      // localStorage not available
      console.warn('Could not persist tenant view mode to localStorage')
    }
  }

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



