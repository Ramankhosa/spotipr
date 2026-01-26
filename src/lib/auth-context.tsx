'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { hasPermission } from '@/lib/permissions'

export interface User {
  user_id: string
  email: string
  tenant_id: string | null
  roles: ('SUPER_ADMIN' | 'SUPER_ADMIN_VIEWER' | 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER')[]
  ati_id: string | null
}

interface PaidSignupResult {
  success: boolean
  error?: string
  isPaidSignup?: boolean
  requiresPayment?: boolean
  planCode?: string
  billingCycle?: string
  userId?: string
  tenantId?: string
}

interface LoginResult {
  success: boolean
  error?: string
  requiresPayment?: boolean
  redirectUrl?: string
  planCode?: string
  billingCycle?: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<LoginResult>
  logout: (logoutAll?: boolean) => Promise<void>
  signup: (email: string, password: string, atiToken: string, firstName: string, lastName: string, isTrialInvite?: boolean) => Promise<{ success: boolean; error?: string }>
  paidSignup: (params: {
    email: string
    password: string
    firstName: string
    lastName: string
    planCode: 'BASIC' | 'PRO' | 'ENTERPRISE'
    billingCycle: 'monthly' | 'yearly'
    companyName?: string
  }) => Promise<PaidSignupResult>
  isLoading: boolean
  refreshUser: (authToken?: string) => Promise<void>
  // Authenticated fetch that automatically handles token refresh
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Token refresh state (shared across all requests)
let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const tokenExpiryRef = useRef<number | null>(null)
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Parse JWT to get expiry time
  const getTokenExpiry = useCallback((jwt: string): number | null => {
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]))
      return payload.exp * 1000 // Convert to milliseconds
    } catch {
      return null
    }
  }, [])

  // Schedule proactive token refresh (before expiry)
  const scheduleTokenRefresh = useCallback((currentToken: string, refreshFn: () => Promise<string | null>) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }

    const expiry = getTokenExpiry(currentToken)
    if (!expiry) return

    // Refresh 2 minutes before expiry (or half the remaining time if less than 4 minutes)
    const now = Date.now()
    const timeUntilExpiry = expiry - now
    const refreshIn = Math.max(timeUntilExpiry - 2 * 60 * 1000, timeUntilExpiry / 2, 30000) // At least 30 seconds

    if (timeUntilExpiry > 0) {
      refreshTimerRef.current = setTimeout(async () => {
        console.log('Proactively refreshing token before expiry')
        await refreshFn()
      }, refreshIn)
    }
  }, [getTokenExpiry])

  // Perform logout (clear state and optionally call server)
  const performLogout = useCallback(async (callServer: boolean = true, logoutAll: boolean = false) => {
    // Clear refresh timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }

    // Call server logout to invalidate refresh token
    if (callServer) {
      try {
        await fetch(`/api/v1/auth/logout${logoutAll ? '?all=true' : ''}`, {
          method: 'POST',
          credentials: 'include',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
      } catch (error) {
        console.error('Logout API error:', error)
      }
    }

    // Clear local state
    setUser(null)
    setToken(null)
    tokenExpiryRef.current = null
    localStorage.removeItem('auth_token')
  }, [token])

  // Refresh access token using refresh token cookie
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    // If already refreshing, wait for that to complete
    if (isRefreshing && refreshPromise) {
      return refreshPromise
    }

    isRefreshing = true
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include' // Include cookies
        })

        if (response.ok) {
          const data = await response.json()
          const newToken = data.token
          setToken(newToken)
          localStorage.setItem('auth_token', newToken)
          tokenExpiryRef.current = getTokenExpiry(newToken)
          scheduleTokenRefresh(newToken, refreshAccessToken)
          return newToken
        } else {
          // Refresh failed - session expired
          console.log('Token refresh failed - session expired')
          await performLogout(false)
          return null
        }
      } catch (error) {
        console.error('Token refresh error:', error)
        await performLogout(false)
        return null
      } finally {
        isRefreshing = false
        refreshPromise = null
      }
    })()

    return refreshPromise
  }, [getTokenExpiry, performLogout, scheduleTokenRefresh])

  // Authenticated fetch with automatic token refresh
  const authFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    let currentToken = token

    // Check if token is expired or about to expire (within 30 seconds)
    const expiry = tokenExpiryRef.current
    if (expiry && Date.now() > expiry - 30000) {
      // Token expired or about to expire - refresh first
      currentToken = await refreshAccessToken()
      if (!currentToken) {
        // Refresh failed - return 401 response
        return new Response(JSON.stringify({ code: 'SESSION_EXPIRED', message: 'Session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Make the request with current token
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...options.headers,
        ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
      }
    })

    // If 401, try to refresh and retry once
    if (response.status === 401 && currentToken) {
      const newToken = await refreshAccessToken()
      if (newToken) {
        // Retry with new token
        return fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${newToken}`
          }
        })
      }
    }

    return response
  }, [token, refreshAccessToken])

  const refreshUser = useCallback(async (authToken?: string) => {
    const tokenToUse = authToken || token
    if (!tokenToUse) {
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/v1/auth/whoami', {
        headers: {
          'Authorization': `Bearer ${tokenToUse}`
        },
        credentials: 'include'
      })

      if (response.ok) {
        const userData = await response.json()
        setUser(userData)
      } else if (response.status === 401) {
        // Token invalid - try refresh
        const newToken = await refreshAccessToken()
        if (newToken) {
          // Retry with new token
          const retryResponse = await fetch('/api/v1/auth/whoami', {
            headers: {
              'Authorization': `Bearer ${newToken}`
            },
            credentials: 'include'
          })
          if (retryResponse.ok) {
            const userData = await retryResponse.json()
            setUser(userData)
          } else {
            await performLogout(false)
          }
        }
      } else {
        await performLogout(false)
      }
    } catch (error) {
      console.error('Failed to refresh user:', error)
      await performLogout(false)
    } finally {
      setIsLoading(false)
    }
  }, [token, refreshAccessToken, performLogout])

  // Load token and user from localStorage on mount
  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('auth_token')
      if (storedToken) {
        const expiry = getTokenExpiry(storedToken)
        
        // Check if token is expired
        if (expiry && Date.now() > expiry) {
          // Token expired - try to refresh
          const newToken = await refreshAccessToken()
          if (newToken) {
            await refreshUser(newToken)
          } else {
            setIsLoading(false)
          }
        } else {
          // Token still valid
          setToken(storedToken)
          tokenExpiryRef.current = expiry
          scheduleTokenRefresh(storedToken, refreshAccessToken)
          await refreshUser(storedToken)
        }
      } else {
        // No token - try to refresh (might have valid refresh token cookie)
        const newToken = await refreshAccessToken()
        if (newToken) {
          await refreshUser(newToken)
        } else {
          setIsLoading(false)
        }
      }
    }

    initializeAuth()

    // Cleanup timer on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [getTokenExpiry, refreshAccessToken, scheduleTokenRefresh, refreshUser])

  const login = async (email: string, password: string): Promise<{
    success: boolean
    error?: string
    requiresPayment?: boolean
    redirectUrl?: string
    planCode?: string
    billingCycle?: string
  }> => {
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include cookies for refresh token
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (response.ok) {
        const { token: newToken, payment_required, redirect_url, plan_code, billing_cycle } = data
        setToken(newToken)
        localStorage.setItem('auth_token', newToken)
        tokenExpiryRef.current = getTokenExpiry(newToken)
        scheduleTokenRefresh(newToken, refreshAccessToken)

        // Get user info
        await refreshUser(newToken)

        // Check if payment is required (user logged in but needs to complete payment)
        if (payment_required) {
          return {
            success: true, // Login succeeded, but payment needed
            requiresPayment: true,
            redirectUrl: redirect_url || '/pricing?checkout=true',
            planCode: plan_code,
            billingCycle: billing_cycle
          }
        }

        return { success: true }
      } else {
        return { success: false, error: data.message || 'Login failed' }
      }
    } catch (error) {
      return { success: false, error: 'Network error' }
    }
  }

  // Traditional ATI-based signup
  const signup = async (
    email: string, 
    password: string, 
    atiToken: string, 
    firstName: string, 
    lastName: string,
    isTrialInvite?: boolean
  ) => {
    try {
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password, atiToken, firstName, lastName, isTrialInvite })
      })

      const data = await response.json()

      if (response.ok) {
        return { success: true, isTrial: data.is_trial }
      } else {
        return { success: false, error: data.message || 'Signup failed' }
      }
    } catch (error) {
      return { success: false, error: 'Network error' }
    }
  }

  // Self-service paid signup (no ATI token required)
  const paidSignup = async (params: {
    email: string
    password: string
    firstName: string
    lastName: string
    planCode: 'BASIC' | 'PRO' | 'ENTERPRISE'
    billingCycle: 'monthly' | 'yearly'
    companyName?: string
  }) => {
    try {
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include cookies for refresh token
        body: JSON.stringify(params)
      })

      const data = await response.json()

      if (response.ok) {
        // Store token if returned (user is now authenticated for payment flow)
        if (data.token) {
          setToken(data.token)
          localStorage.setItem('auth_token', data.token)
          tokenExpiryRef.current = getTokenExpiry(data.token)
          scheduleTokenRefresh(data.token, refreshAccessToken)
        }

        return { 
          success: true, 
          isPaidSignup: data.is_paid_signup,
          requiresPayment: data.requires_payment,
          planCode: data.plan_code,
          billingCycle: data.billing_cycle,
          userId: data.user_id,
          tenantId: data.tenant_id,
        }
      } else {
        return { success: false, error: data.message || 'Signup failed' }
      }
    } catch (error) {
      return { success: false, error: 'Network error' }
    }
  }

  const logout = async (logoutAll: boolean = false) => {
    await performLogout(true, logoutAll)
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      signup,
      paidSignup,
      isLoading,
      refreshUser,
      authFetch
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper function to check if user has any of the specified roles
function hasAnyRole(user: any, roles: string[]): boolean {
  if (!user?.roles) return false;
  return roles.some(role => user.roles.includes(role));
}

// Helper function to check if user has all of the specified roles
function hasAllRoles(user: any, roles: string[]): boolean {
  if (!user?.roles) return false;
  return roles.every(role => user.roles.includes(role));
}

// Role-based access helpers
export function useRoleAccess() {
  const { user } = useAuth()

  // Determine tenant type based on user's tenant context
  // For security, default to ENTERPRISE (strict permissions)
  let tenantType: 'INDIVIDUAL' | 'ENTERPRISE' = 'ENTERPRISE'

  // Simple heuristic: if this is a platform admin context or enterprise tenant, use ENTERPRISE
  // Individual tenants would be explicitly marked as such in the future
  if (user?.ati_id === 'PLATFORM') {
    tenantType = 'ENTERPRISE'
  } else if (user?.tenant_id) {
    // For now, assume all named tenants are ENTERPRISE
    // This can be enhanced to fetch actual tenant type from API
    tenantType = 'ENTERPRISE'
  }

  return {
    // Treat SUPER_ADMIN_VIEWER as a super admin for navigation/visibility,
    // but permissions are enforced separately in the API layer.
    isSuperAdmin: hasAnyRole(user, ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER']),
    isSuperAdminViewer: hasAnyRole(user, ['SUPER_ADMIN_VIEWER']),
    isTenantOwner: hasAnyRole(user, ['OWNER']),
    isTenantAdmin: hasAnyRole(user, ['OWNER', 'ADMIN']),
    isManager: hasAnyRole(user, ['MANAGER']),
    isAnalyst: hasAnyRole(user, ['ANALYST']),
    isViewer: hasAnyRole(user, ['VIEWER']),

    // Context-aware permissions (consider tenant type)
    canManageUsers: hasPermission(user, 'manage_users', tenantType),
    canManageTokens: hasPermission(user, 'manage_ati_tokens', tenantType),
    canManageTenants: hasPermission(user, 'manage_tenants', tenantType),
    canViewReports: hasPermission(user, 'view_reports', tenantType),
    canViewAnalytics: hasPermission(user, 'view_analytics', tenantType),
    canCreateProjects: hasPermission(user, 'create_projects', tenantType),
    canUseProduct: hasPermission(user, 'access_novelty_search', tenantType),

    // Additional helpers for multiple role checks
    hasRoles: (roles: string[]) => hasAnyRole(user, roles),
    hasAllRoles: (roles: string[]) => hasAllRoles(user, roles),
    userRoles: user?.roles || []
  }
}
