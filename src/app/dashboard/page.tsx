'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import SuperAdminDashboard from '@/components/dashboards/SuperAdminDashboard'
import TenantAdminDashboard from '@/components/dashboards/TenantAdminDashboard'
import UserDashboard from '@/components/dashboards/UserDashboard'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { isSuperAdmin, isTenantAdmin } = useRoleAccess()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login')
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  // Render different dashboards based on user role
  if (isSuperAdmin) {
    return <SuperAdminDashboard />
  }

  if (isTenantAdmin) {
    return <TenantAdminDashboard />
  }

  // Default user dashboard (ANALYST, VIEWER, etc.)
  return <UserDashboard />
}
